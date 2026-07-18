-- M4: 話題カード（アイスブレイクのお題）
-- topic_cards テーブルと、ランダムに 1 件引く関数、シードデータを定義する。
--
-- 設計方針（docs/implementation-plan.md 4 節・6 節 M4、docs/screen-flow-design.md SC-007 / OV-04、CLAUDE.md）:
--  * お題は「固定リストからのランダム提示」に留める（実装計画 10 節: 高度なレコメンドはやらない）。
--  * 取得はインターフェース＋アダプター（TopicCardRepository）越しに行う。ランダム抽出は
--    DB 側の関数 get_random_topic_card に閉じ込め、直前に引いたお題を除外して「別のお題」を引けるようにする。
--  * お題の中身（interview-decisions.md の未決事項）は「技術イベントの懇親会向けを中心に、
--    一般的な話題も 2〜3 割混ぜる」方針で確定させる（category = 'tech' | 'general'）。
--    お題そのものはユーザー向けの表示データ（マスタ）なので、UI 文言を TS に置く D8 の原則の例外として
--    ここ（DB）にシードで持つ。差し替え時も標準 Postgres の行データとして持ち出せる。
--  * RLS は全テーブルで有効化・ポリシー無し（anon 直接アクセス拒否）。service_role にのみ GRANT する。

-- ── topic_cards: 話題カードのお題マスタ ─────────────────────────────────────
create table public.topic_cards (
  id          uuid primary key default gen_random_uuid(),
  -- お題のカテゴリ。'tech' = 技術イベントの懇親会向け / 'general' = 一般的な雑談。
  category    text not null check (category in ('tech', 'general')),
  prompt_text text not null check (char_length(prompt_text) <= 100)
);

comment on table public.topic_cards is '話題カードのお題マスタ（アイスブレイク・D7）。固定リストからランダム提示する。';

-- ── RLS: 有効化。ポリシー無し = anon / authenticated は全拒否 ─────────────────
alter table public.topic_cards enable row level security;

-- ── GRANT: service_role にのみ権限を付与 ────────────────────────────────────
grant all on public.topic_cards to service_role;

-- ── get_random_topic_card: ランダムに 1 件返す（直前のお題を除外可能） ──────────
-- 「別のお題を引く」で同じお題が連続しないよう、p_exclude_id を除外して抽選する。
-- 除外して 0 件になる（お題が実質 1 件）ケースに備え、除外なしのフォールバックも持つ。
create or replace function public.get_random_topic_card(p_exclude_id uuid default null)
returns table (
  id          uuid,
  category    text,
  prompt_text text
)
language sql
volatile
set search_path = public
as $$
  select tc.id, tc.category, tc.prompt_text
  from public.topic_cards tc
  where p_exclude_id is null or tc.id <> p_exclude_id
  order by random()
  limit 1;
$$;

grant execute on function public.get_random_topic_card(uuid) to service_role;

-- ── シードデータ: 技術イベントの懇親会向けを中心に、一般的な話題を 2〜3 割混ぜる ──
-- 技術系 19 件・一般系 7 件（一般が約 27%）。
insert into public.topic_cards (category, prompt_text) values
  ('tech',    '最近さわって良かった技術は？'),
  ('tech',    '今日のセッションで一番刺さった話は？'),
  ('tech',    '普段のエディタや開発環境の推しは？'),
  ('tech',    '最近読んで良かった技術書や記事は？'),
  ('tech',    '今ハマっている個人開発やサイドプロジェクトは？'),
  ('tech',    '使ってみたいけど、まだ試せていない技術は？'),
  ('tech',    '好きなプログラミング言語と、その理由は？'),
  ('tech',    '直近で解決できて嬉しかったバグやトラブルは？'),
  ('tech',    'チーム開発で大事にしていることは？'),
  ('tech',    'AI ツールを開発にどう使っている？'),
  ('tech',    'キーボードやデスク周りのこだわりは？'),
  ('tech',    '新しい技術のキャッチアップはどうやってる？'),
  ('tech',    '初めて書いたプログラムやサービスは？'),
  ('tech',    '好きな設計やアーキテクチャの考え方は？'),
  ('tech',    '最近のアップデートで注目しているものは？'),
  ('tech',    'リモートワークと出社、どっち派？その理由は？'),
  ('tech',    '勉強会やカンファレンス、よく参加する？おすすめは？'),
  ('tech',    'エンジニアになったきっかけは？'),
  ('tech',    '今日のイベントに参加した理由は？'),
  ('general', '出身はどこ？おすすめのスポットは？'),
  ('general', '最近ハマっている食べ物やお店は？'),
  ('general', '休日はどんなふうに過ごしてる？'),
  ('general', '最近見て面白かった映画・ドラマ・アニメは？'),
  ('general', '好きな飲み物は？コーヒー派？お茶派？'),
  ('general', '今いちばん行ってみたい場所は？'),
  ('general', '最近始めた趣味やチャレンジは？');
