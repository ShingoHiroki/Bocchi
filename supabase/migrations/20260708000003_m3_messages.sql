-- M3: ルームチャット
-- messages テーブルと、システム初期メッセージを「ルームごとに 1 件だけ」冪等に入れる関数を定義する。
--
-- 設計方針（docs/implementation-plan.md 4 節・7 節、docs/screen-flow-design.md SC-007、CLAUDE.md）:
--  * メッセージ本文・クイック返信などの「文言」は Supabase 非依存の TS 側（domain/services/chat-content.ts）に置く。
--    ここ（DB）はスキーマと、システムメッセージの重複投稿を防ぐ制約・関数に責務を絞る。
--  * システム自動投稿（D4）は「ルーム作成・参加・マッチ成立」の複数経路から呼ばれる。
--    どの経路から何度呼ばれても 1 ルームにつき 1 件だけになるよう、
--    部分ユニークインデックス（system_kind ごと）＋ ON CONFLICT DO NOTHING で冪等化する。
--  * sender_device_id は「自分の発言」を右寄せ表示するための識別子（認証なし・D6。
--    room_members / lobby_entries と同じく端末発行の device_id で本人を判定する）。
--    system メッセージでは NULL。実装計画のカラム例には無いが、右寄せ表示要件のため追加する。
--  * RLS は全テーブルで有効化・ポリシー無し（anon 直接アクセス拒否）。service_role にのみ GRANT する。

-- ── messages: ルームチャットのメッセージ ────────────────────────────────────
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms (id) on delete cascade,
  sender_type      text not null check (sender_type in ('system', 'user')),
  -- system メッセージの種別（'welcome' 等）。ユーザー投稿では NULL。
  -- ルームごとに同一種別のシステムメッセージを 1 件に制限するために使う。
  system_kind      text,
  -- 送信者の端末識別子（本人の右寄せ表示用）。system メッセージでは NULL。
  sender_device_id text,
  sender_nickname  text not null,
  body             text not null check (char_length(body) <= 500),
  created_at       timestamptz not null default now(),
  -- 種別の整合性: system は system_kind を持ち device_id を持たない / user はその逆、を緩く担保する。
  constraint messages_system_shape check (
    (sender_type = 'system' and sender_device_id is null)
    or (sender_type = 'user' and system_kind is null)
  )
);

comment on table public.messages is 'ルームチャットのメッセージ。sender_type=system は自動投稿（集合相談の初期メッセージ等）。';
create index messages_room_id_created_at_idx on public.messages (room_id, created_at);
-- ルームごとに同一種別のシステムメッセージは 1 件だけ（重複投稿防止の要）。
create unique index messages_one_system_kind_per_room
  on public.messages (room_id, system_kind)
  where system_kind is not null;

-- ── RLS: 有効化。ポリシー無し = anon / authenticated は全拒否 ─────────────────
alter table public.messages enable row level security;

-- ── GRANT: service_role にのみ権限を付与 ────────────────────────────────────
grant all on public.messages to service_role;

-- ── ensure_system_message: システムメッセージを冪等に投稿する（重複防止・D4） ──
-- ルーム作成・参加・マッチ成立の複数経路から呼ばれても、
-- (room_id, system_kind) の部分ユニークインデックスに対する ON CONFLICT DO NOTHING により
-- 1 ルームにつき同一種別 1 件だけになる（並行呼び出しでも安全）。
create or replace function public.ensure_system_message(
  p_room_id  uuid,
  p_kind     text,
  p_nickname text,
  p_body     text
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.messages (room_id, sender_type, system_kind, sender_nickname, body)
  values (p_room_id, 'system', p_kind, p_nickname, p_body)
  on conflict (room_id, system_kind) where system_kind is not null do nothing;
$$;

grant execute on function public.ensure_system_message(uuid, text, text, text) to service_role;
