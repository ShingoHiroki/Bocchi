# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**Bocchi** — カンファレンスや懇親会などのイベントで「1人ぼっち」になるのを回避するためのアプリ。

同じイベントに参加している人同士をつなぎ、話し相手やグループを見つけやすくすることが目的。

## 現在の状態

M3（ルームチャット）まで完了。M2 までに加えて、マッチ成立・ルーム作成・ルーム参加のいずれの経路でも、
集合場所の相談を促すシステム初期メッセージ（D4）がルームに自動投稿される（1 ルーム 1 件・重複なし）。
SC-007 ルームチャット画面を本実装し、システム／参加者メッセージの区別・自分の発言の右寄せ・クイック返信チップ
（1 タップ送信）・自由入力送信・メンバー表示（ニックネーム＋任意 X リンク）・退室（OV-02 確認 → room_members
から除去 → ルーム一覧）を備える。複数端末間の同期は Server Action のポーリング（3 秒間隔）で行う。
話題カードは M4 のため「準備中」ボタンのみ。M4 以降（話題カード本実装・TTL 物理削除・磨き込み）は未着手。

M3 で追加したもの:

- マイグレーション `supabase/migrations/20260708000003_m3_messages.sql`
  - `messages`（`room_id` / `sender_type`(system|user) / `system_kind` / `sender_device_id`（本人の右寄せ判定用・
    system は NULL）/ `sender_nickname` / `body`(<=500) / `created_at`）。RLS 有効・ポリシー無し・service_role にのみ GRANT。
  - 重複防止の要: 部分ユニークインデックス `messages_one_system_kind_per_room (room_id, system_kind) where system_kind is not null`。
  - DB 関数 `ensure_system_message(room_id, kind, nickname, body)`: `ON CONFLICT DO NOTHING` で冪等投稿。
    ルーム作成・参加・マッチ成立の複数経路から何度呼ばれても 1 ルーム 1 件に収束する（並行呼び出しでも安全）。
- ドメイン層: インターフェース `ChatRepository`（`listMessages` / `postMessage` / `ensureSystemMessage`）、
  文言の集約 `src/lib/domain/services/chat-content.ts`（システム初期メッセージ本文・クイック返信候補・種別 `welcome`。
  UI 文言を DB に埋め込まず TS 側に置く＝ D8 の移植性方針）、`validateMessageBody`（空送信不可・500 文字以内・空白のみ不可）。
- アダプター層: `SupabaseChatRepository`（`src/lib/adapters/supabase/chat-repository.ts`）。`ensureSystemMessage` は
  `ensure_system_message` RPC を呼ぶ。`RoomRepository.leave(roomId, deviceId)` を追加（退室 = room_members から除去）。
- 設定値: `ROOM_MESSAGES_POLL_INTERVAL_MS=3s`（`src/lib/matching-config.ts`。チャット同期のポーリング間隔）。
- Server Actions（`src/app/actions.ts`）: `getRoomChat`（初回ロード。welcome を保証しつつルーム・メンバー・メッセージを返す）/
  `pollRoomMessages`（同期用の軽量取得）/ `postRoomMessage`（バリデーション付き投稿）/ `leaveRoom`。
  併せて `createRoom` / `joinRoom` / `lobbyTick`（matched 分岐）にシステム自動投稿を組み込んだ。
- 画面 SC-007 ルームチャット（`src/app/e/[slug]/rooms/[roomId]/page.tsx`、プレースホルダを置き換え）:
  メッセージリスト（system は中央・参加者は左／自分は右寄せ・楽観表示と失敗時の再送）、クイック返信チップ、
  入力欄＋送信、メンバー表示、OV-02 退室確認、接続断バー、満員／未参加時の導線、話題カードは「準備中」。

### M3 の設計判断（システム自動投稿の重複防止）

- **重複防止 = DB の部分ユニークインデックス + `ON CONFLICT DO NOTHING`（`ensure_system_message`）**。
  システム初期メッセージ（D4）は「マッチ成立・ルーム作成・ルーム参加・チャット初回ロード」の複数経路から
  投げられうるため、アプリ側の「投稿前 SELECT で有無確認」では並行実行時に競合して二重投稿になりうる。
  そこで `(room_id, system_kind)` の部分ユニークインデックスを唯一の真実とし、DB 関数で冪等 INSERT する。
  どの経路から何回呼ばれても 1 ルームにつき `welcome` は必ず 1 件。文言は TS（chat-content.ts）に置き、
  アダプター越しに渡すことで DB マイグレーションに UI 文言を埋め込まない（D8）。
- **複数端末同期 = ポーリング（R1 と整合）**。M2 のロビーと同じく、ブラウザから Supabase を直接購読せず
  （R2: anon 直接アクセス拒否）、`pollRoomMessages` を 3 秒間隔で呼ぶ。取得は `ChatRepository`（アダプター層）に
  隔離してあり、将来 Supabase Realtime へトリガーだけ差し替えられる。

M2 で追加したもの:

- マイグレーション `supabase/migrations/20260708000002_m2_lobby_matching.sql`
  - `lobby_entries`（`event_id` / `nickname` / `x_account` / `device_id` / `entered_at` / `matched_room_id` ほか、
    `unique(event_id, device_id)` で同一端末の二重待機を禁止）。RLS 有効・ポリシー無し・service_role にのみ GRANT。
  - DB 関数 `apply_match_plan(event_id, assignments, new_rooms, default_capacity)`: 判定結果（プラン）を
    `pg_advisory_xact_lock`（イベント単位）下で原子的に適用する。`matched_room_id IS NULL` のときだけ確保する
    条件付き UPDATE と、insert 前のロック下人数再確認で、二重割当・定員超過・空ルーム量産を防ぐ（R3）。
  - DB 関数 `join_room(...)`: M1 の素朴な check-then-insert を置き換え、同じイベントロック下で「人数 < 定員」を
    確認してから insert する。同時 join でも定員を超えない（R3）。
- ドメイン層（Supabase 非依存の純粋関数）: `decideMatch(waiting, openRooms, rule, now): MatchResult`
  （`src/lib/domain/services/matching.ts`）。しきい値超過の待機者を、①既存ルームの空きへ割当→②残りを既定定員で
  グループ化して新ルーム、と判定する。1 人余りは待機継続。
- 調整値の集約: `src/lib/matching-config.ts`（`MATCH_WAIT_THRESHOLD_MS=60s` / `LOBBY_TICK_INTERVAL_MS=5s` /
  `DEFAULT_ROOM_CAPACITY=3` / `MATCH_WAIT_TARGET_MAX_MS=90s`）。しきい値・tick 間隔・定員はここだけを直す。
- ドメイン層インターフェース `LobbyRepository` とアダプター `SupabaseLobbyRepository`
  （enqueue / dequeue / getEntry / listWaiting / countWaiting / applyMatchPlan）。待機状態の取得・購読は
  この層に隔離する（R1・R2 と整合）。
- Server Actions（`src/app/actions.ts`）: `enterLobby` / `leaveLobby` / `lobbyTick`。
  `lobbyTick` はクライアント主導トリガー（R4）で、呼ばれるたびに decideMatch を実行して適用し、
  併せて自分の状態（待機人数・マッチ成立）を返すポーリング窓口（R1）を兼ねる。
- 画面 SC-006 ロビー待機（`src/app/e/[slug]/lobby/page.tsx`）: 5 秒間隔の tick、待機人数・経過時間表示、
  「待機をやめる」「自分でルームを選ぶ」、単独待機時の受け皿ルーム作成導線、通信断時の「再接続中…」表示。
  OV-01 マッチ成立オーバーレイ（`src/components/match-overlay.tsx`、視覚主・Web Audio の効果音／`navigator.vibrate` 従、
  タップで SC-007 へ）。SC-004 の「おまかせで待つ」を実ロビーに接続。

### M2 の設計判断（R1 / R3 / R4）

- **R4 マッチング実行トリガー = クライアント主導 tick**。ロビー画面が 5 秒おきに Server Action `lobbyTick` を呼び、
  サーバー側で decideMatch を実行・適用する。Vercel Cron / pg_cron 不要でローカル完結（`supabase start` + `npm run dev`
  だけで動く）ため採用。代替の pg_cron はローカルでの常時実行の担保が要り、Vercel Cron はクラウド前提で
  「ローカル完結」に反するため見送り。判定は純粋関数のままなので、将来トリガーだけ差し替え可能（R4 の要件）。
- **R3 競合制御 = イベント単位のアドバイザリロック + 条件付き UPDATE + insert 前人数再確認**。
  supabase-js（PostgREST）は複数呼び出しをまたぐトランザクションを張れないため、原子性が要る適用は DB 関数に閉じ込め、
  `pg_advisory_xact_lock` で同一イベントの適用（マッチ適用・join）を直列化。`matched_room_id IS NULL` のときだけ
  確保する UPDATE で「1 エントリ 1 回だけマッチ」を保証し、insert 前にロック下で人数を数えて定員超過を防ぐ。
  10 端末同時 tick / 10 端末同時 join でも二重割当・定員超過・取り残しが出ないことを実測で確認済み。
- **R1 リアルタイム更新 = ポーリング**。ブラウザから Supabase を直接購読すると「anon 直接アクセス拒否」（R2）と
  矛盾するため、tick が待機人数・自分の状態を併せて返すポーリング方式を採用（プロトタイプには十分・実装が単純）。
  取得ロジックは `LobbyRepository` に隔離してあり、将来 Supabase Realtime Broadcast（サーバー送信・ブラウザは購読のみ）に
  差し替える余地を残す。

M1 で追加したもの:

- マイグレーション `supabase/migrations/20260708000001_m1_events_rooms_members.sql`
  （`events` / `rooms` / `room_members`、pg_trgm による類似イベント検索関数 `search_similar_events`）。
  全テーブルで RLS を有効化し、ポリシーは作らない＝anon / authenticated は直接アクセス不可。
  service_role にのみ GRANT する（この Supabase プロジェクトは新規テーブルの Data API 自動公開が無効なため明示 GRANT が必要）。
- サーバー側は service_role キー（`.env.local` の `SUPABASE_SERVICE_ROLE_KEY`。`NEXT_PUBLIC_` を付けない）で DB を操作する（R2）。
  クライアントは Server Action（`src/app/actions.ts`）経由でのみ DB に触れ、ブラウザから直接 Supabase を呼ばない。
- ドメイン層: `EventRepository` / `RoomRepository`（`src/lib/domain/interfaces/`）、
  ハッシュタグ正規化・各画面バリデーションの純粋関数（`src/lib/domain/services/`）。
- アダプター層: `SupabaseEventRepository` / `SupabaseRoomRepository`（`src/lib/adapters/supabase/`）。
- 端末ローカル保存: ニックネーム・任意の X アカウント・`device_id`（`src/lib/local/`）。
- 画面: SC-001 オンボーディング / SC-002 ホーム＋SC-003 作成確認 / SC-004 ルーム一覧 / SC-005 ルーム作成 /
  SC-007 ルーム詳細（M3 までプレースホルダ）/ SC-008 プロフィール編集 / SC-009 期限切れ・エラー。
  SC-006 ロビーは M2 のため導線のみ（準備中表示）。QR コード表示・共有 URL コピーは `qrcode` を使用。

- 企画（課題仮説・競合分析・MVP 検証設計）: `docs/product-discovery.md`
- 設計インタビューの決定事項（体験フロー・MVP 範囲・技術選定）: `docs/interview-decisions.md`
- 画面フロー設計書（画面一覧・遷移図・画面仕様・エッジケース）: `docs/screen-flow-design.md`
- 実装計画書（マイルストーン M0〜M5・ディレクトリ構成案・テーブル案・技術リスク）: `docs/implementation-plan.md`

実装時は `docs/implementation-plan.md` のマイルストーン順（M0→M5）に従い、画面の仕様は `docs/screen-flow-design.md` の画面 ID（SC-001〜SC-009）を参照すること。

## 決定済みの技術方針

- **スタック**: Next.js + Supabase（本番運用は Vercel + Supabase 無料枠）
- **開発環境はローカル完結**: Supabase はローカル Docker で動かす（Supabase CLI の `supabase start`）。Next.js は Docker なしでホスト上で直接起動する。**Vercel デプロイとクラウド Supabase への疎通はユーザー自身が手動で行う**ため、Claude は実施しないこと（環境変数の差し替えだけでクラウドへ向けられる作りを保つ）
- **リアルタイム**（チャット・ロビー更新・マッチ通知）: Supabase Realtime
- **移植性の要件（重要）**: Supabase 依存はアダプター層（例: `src/lib/adapters/`）に隔離し、UI・ドメインロジックはインターフェース越しに使う。スキーマは素の SQL マイグレーションで管理する。Supabase の API をアダプター層の外から直接呼ばないこと
- 認証なし（ニックネーム入力のみ、端末ローカル保存）

## コア体験（確定済み）

URL/QR またはハッシュタグ入力でイベントに入室（なければ自動作成・正規化必須）→ ルーム一覧から選ぶ or ロビーで待って自動マッチング（空きのある既存ルーム優先）→ ルームチャットで集合場所を相談して物理合流（システムが最初のメッセージを自動投稿）。

詳細と仮置きパラメータ（TTL 24h、ロビー待機 60〜90 秒、デフォルト定員 3 人）は `docs/interview-decisions.md` を参照。

## 開発コマンド

前提: Docker が起動していること。初回は `npm install` 後に `supabase start` で
Docker イメージのダウンロードが走るため数分かかることがある。

```bash
# 依存パッケージのインストール
npm install

# ローカル Supabase の起動（Docker）。API URL / anon key 等は起動時の出力か `supabase status` で確認
supabase start

# ローカル Supabase の停止
supabase stop

# マイグレーションの適用（supabase/migrations/ の SQL をローカル DB に反映。差分検知して適用）
supabase db reset

# 開発サーバーの起動（http://localhost:3000）。事前に .env.local が必要（.env.local.example を参照）
npm run dev

# ビルド
npm run build

# Lint（ESLint）
npm run lint

# フォーマット（Prettier）
npm run format        # 適用
npm run format:check  # チェックのみ

# アプリをコンテナで起動（動作確認・配布用。普段の開発はホストの npm run dev）
# 事前に supabase start と .env.local が必要
docker compose up --build
```

- `supabase db reset` はローカル DB を作り直した上で `supabase/migrations/` の SQL を順に適用する
  （破壊的操作なので、ローカル DB のデータが消えてよいことを確認してから実行する）
- 自動テストの網羅的整備は方針として行わない（10 節）。動作確認は `npm run lint` /
  型チェック（`npx tsc --noEmit`）と手動確認を中心に行う

## ディレクトリ構成の意図とデータフロー

`docs/implementation-plan.md` 4 節のアーキテクチャ方針をそのまま採用している。

```
src/
  app/                      … Next.js App Router（画面・Route Handler）
  lib/
    domain/
      interfaces/           … EventRepository, RoomRepository 等のインターフェース定義（Supabase 非依存）
      services/              … マッチング判定ロジック等、Supabase 非依存の純粋関数
    adapters/
      supabase/              … Supabase 依存を閉じ込める実装（クライアント生成・Repository 実装・Realtime 購読）
    local/                   … 端末ローカル保存（ニックネーム・device_id）
  components/                … UI コンポーネント（ドメイン層・アダプター層に直接依存しない）
supabase/
  migrations/                … 素の SQL マイグレーション（Supabase CLI 規約ディレクトリ）
```

データフローの原則（M0 で確立し、以降も維持する）:

- UI・ドメインロジックは `lib/domain/interfaces/` のインターフェース越しにのみデータ操作を行い、
  `lib/adapters/supabase/` の実装や `@supabase/supabase-js` を直接 import しない
  （`@supabase/supabase-js` の import は `src/lib/adapters/supabase/` 配下に閉じ込める）
- Supabase クライアントの生成は `src/lib/adapters/supabase/client.ts` の
  `getSupabaseServerClient()` に集約する
- サーバー側（Route Handler / Server Component / Server Action）からのみ Supabase にアクセスし、
  クライアント（ブラウザ）から直接 Supabase を呼ばない構成を維持する（R2）
- マッチング判定ロジックのような Supabase 非依存の処理は `lib/domain/services/` に純粋関数として置き、
  「いつ実行するか」だけをアダプター層で差し替え可能にする（R4）

## 今後の方針

マイルストーンをクローズするたびに、このファイルの該当節を更新すること（`docs/implementation-plan.md` 8 節）。
