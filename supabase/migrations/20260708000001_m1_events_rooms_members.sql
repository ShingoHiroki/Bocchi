-- M1: 入室〜ルーム一覧の縦切り
-- events / rooms / room_members の 3 テーブルと、類似イベント検索用の関数を定義する。
--
-- 設計方針（docs/implementation-plan.md 4 節・7 節 R2 / R5、CLAUDE.md）:
--  * 全テーブルで RLS を有効化する。ポリシーを 1 つも作らないため、
--    RLS をバイパスしない role（anon / authenticated）は一切アクセスできない（= 直接アクセス拒否）。
--  * サーバー側は service_role キーで操作する。service_role は BYPASSRLS を持つため RLS を素通りする。
--  * ただし本プロジェクトの config.toml では新規テーブルの Data API 自動公開が無効
--    （auto_expose_new_tables 未設定 = 常に revoke）なので、service_role に明示的に GRANT する必要がある。
--    anon / authenticated には GRANT しない（R2: ブラウザからの直接アクセスを塞ぐ）。
--  * expires_at は「作成から 24 時間」（D7）。期限切れの除外は一覧クエリの WHERE で行う（物理削除ジョブは M4）。

-- 類似イベント検索（表記ゆれ吸収）のための trigram 拡張（R5）。
create extension if not exists pg_trgm with schema extensions;

-- ── events: イベント（ハッシュタグ単位の箱） ───────────────────────────────
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                 -- 共有 URL 用の識別子（/e/{slug}）
  display_name    text not null,                        -- 表示名（ユーザー入力の原文ベース）
  normalized_name text not null,                        -- 正規化名（照合・類似検索に使う）
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours')
);

comment on table public.events is 'イベント。作成から 24 時間で期限切れ（expires_at）。';
create index events_normalized_name_trgm_idx on public.events using gin (normalized_name extensions.gin_trgm_ops);
create index events_expires_at_idx on public.events (expires_at);

-- ── rooms: イベント内のトークルーム ────────────────────────────────────────
create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  name       text not null,
  capacity   smallint not null default 3 check (capacity between 2 and 6),  -- D5: 2〜6、既定 3
  status     text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

comment on table public.rooms is 'ルーム。定員 2〜6（既定 3）。作成から 24 時間で期限切れ。';
create index rooms_event_id_idx on public.rooms (event_id);
create index rooms_expires_at_idx on public.rooms (expires_at);

-- ── room_members: ルーム参加者 ─────────────────────────────────────────────
create table public.room_members (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  nickname   text not null,
  x_account  text,                       -- 任意の X ユーザー名（@ なし）
  device_id  text not null,              -- 認証なしのため端末発行の識別子で「自分」を判定（D6）
  joined_at  timestamptz not null default now(),
  -- 同一端末が同じルームに二重参加しないようにする（join の冪等化にも使う）
  unique (room_id, device_id)
);

comment on table public.room_members is 'ルーム参加者。device_id で端末（=ユーザー）を識別する（認証なし）。';
create index room_members_room_id_idx on public.room_members (room_id);

-- ── RLS: 全テーブルで有効化。ポリシー無し = anon / authenticated は全拒否 ──────
alter table public.events        enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_members  enable row level security;

-- ── GRANT: service_role にのみ権限を付与（anon / authenticated には付与しない） ──
grant all on public.events       to service_role;
grant all on public.rooms        to service_role;
grant all on public.room_members to service_role;

-- ── 類似イベント検索関数（pg_trgm の similarity で normalized_name を照合） ─────
-- SECURITY INVOKER（既定）。service_role から呼ぶ前提。member_count も併せて返す（SC-003 の表示用）。
create or replace function public.search_similar_events(
  query_normalized text,
  max_results int default 5
)
returns table (
  id              uuid,
  slug            text,
  display_name    text,
  normalized_name text,
  created_at      timestamptz,
  expires_at      timestamptz,
  member_count    bigint,
  similarity      real
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.slug,
    e.display_name,
    e.normalized_name,
    e.created_at,
    e.expires_at,
    (
      select count(*)
      from public.room_members rm
      join public.rooms r on r.id = rm.room_id
      where r.event_id = e.id
    ) as member_count,
    extensions.similarity(e.normalized_name, query_normalized) as similarity
  from public.events e
  where e.expires_at > now()
    and e.normalized_name <> query_normalized                  -- 完全一致は類似候補から除く
    and extensions.similarity(e.normalized_name, query_normalized) > 0.3
  order by similarity desc
  limit max_results;
$$;

grant execute on function public.search_similar_events(text, int) to service_role;
