-- M2: ロビー自動マッチ
-- lobby_entries テーブルと、競合制御（R3）を DB レベルで保証する 2 つの関数を定義する。
--
-- 設計方針（docs/implementation-plan.md 7 節 R3 / R4、CLAUDE.md）:
--  * マッチングの「判定ロジック」は Supabase 非依存の純粋関数 decideMatch（TS 側）に置く。
--    ここ（DB）は、その判定結果（プラン）を「原子的に・二重割当なく」適用することに責務を絞る。
--  * 競合制御は pg_advisory_xact_lock（イベント単位のトランザクションロック）で
--    「同一イベントに対する適用（マッチ適用・ルーム参加）を直列化」して保証する。
--    加えて lobby_entries を matched_room_id が NULL のときだけ更新する条件付き UPDATE で
--    「1 エントリは一度しかマッチしない」ことを保証し、二重割当を防ぐ。
--  * M1 の素朴な join（check-then-insert）も join_room 関数に置き換え、
--    同じイベントロック下で人数を数えてから insert することで定員超過を防ぐ。
--  * RLS は全テーブルで有効化・ポリシー無し（anon 直接アクセス拒否）。
--    関数は service_role からのみ実行する前提で GRANT する。

-- ── lobby_entries: ロビー待機者 ────────────────────────────────────────────
create table public.lobby_entries (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  nickname        text not null,
  x_account       text,                                   -- 任意の X ユーザー名（@ なし）
  device_id       text not null,                          -- 端末識別子（認証なし・D6）
  entered_at      timestamptz not null default now(),     -- 待機開始時刻（経過時間・マッチ対象判定に使う）
  matched_room_id uuid references public.rooms (id) on delete set null,  -- マッチ済みなら割当先ルーム
  matched_at      timestamptz,
  -- 同一イベントに同一端末が二重に並ばないようにする（enqueue の冪等化にも使う）
  unique (event_id, device_id)
);

comment on table public.lobby_entries is 'ロビー待機者。matched_room_id が NULL の間だけ「待機中」。60〜90 秒経過でマッチ対象。';
create index lobby_entries_event_id_idx on public.lobby_entries (event_id);
-- 待機中（未マッチ）の抽出を速くする部分インデックス。
create index lobby_entries_waiting_idx on public.lobby_entries (event_id, entered_at)
  where matched_room_id is null;

-- ── RLS: 有効化。ポリシー無し = anon / authenticated は全拒否 ─────────────────
alter table public.lobby_entries enable row level security;

-- ── GRANT: service_role にのみ権限を付与 ────────────────────────────────────
grant all on public.lobby_entries to service_role;

-- ── join_room: 定員超過を DB で防ぐルーム参加（M1 の check-then-insert を強化・R3） ─
-- イベント単位のアドバイザリロック下で「人数 < 定員」を確認してから insert するため、
-- 同時参加でも定員を超えない。既参加・満員・未存在を status で区別する。
create or replace function public.join_room(
  p_room_id   uuid,
  p_nickname  text,
  p_x_account text,
  p_device_id text
)
returns table (
  status    text,     -- 'joined' | 'already_member' | 'full' | 'not_found'
  member_id uuid,
  nickname  text,
  x_account text,
  device_id text,
  joined_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_id uuid;
  v_capacity int;
  v_count    int;
  v_existing public.room_members%rowtype;
  v_inserted public.room_members%rowtype;
begin
  -- 有効な（open・未期限切れ）ルームか確認。
  select r.event_id, r.capacity into v_event_id, v_capacity
  from public.rooms r
  where r.id = p_room_id and r.status = 'open' and r.expires_at > now();

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 同一イベントへの参加・マッチ適用を直列化する（定員超過・二重割当防止の要）。
  perform pg_advisory_xact_lock(hashtext('bocchi:event:' || v_event_id::text));

  -- 既に参加済み（同一端末）なら冪等に成功扱い。
  select * into v_existing
  from public.room_members
  where room_id = p_room_id and room_members.device_id = p_device_id;
  if found then
    return query select 'already_member'::text, v_existing.id, v_existing.nickname,
                        v_existing.x_account, v_existing.device_id, v_existing.joined_at;
    return;
  end if;

  -- ロック下で人数を数え、定員に達していれば満員。
  select count(*) into v_count from public.room_members where room_id = p_room_id;
  if v_count >= v_capacity then
    return query select 'full'::text, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  insert into public.room_members (room_id, nickname, x_account, device_id)
  values (p_room_id, p_nickname, p_x_account, p_device_id)
  returning * into v_inserted;

  return query select 'joined'::text, v_inserted.id, v_inserted.nickname,
                      v_inserted.x_account, v_inserted.device_id, v_inserted.joined_at;
end;
$$;

grant execute on function public.join_room(uuid, text, text, text) to service_role;

-- ── apply_match_plan: 判定結果（プラン）を原子的に適用する（R3） ─────────────────
-- TS 側の純粋関数 decideMatch が決めた「①既存ルームへの割当」「②新ルームのグループ」を受け取り、
-- イベントロック下で再検証しながら適用する。並行 tick が同じプランを持ち込んでも、
--  * lobby_entries は matched_room_id IS NULL のときだけ更新（1 エントリ 1 回だけマッチ）
--  * ルームへの insert 前にロック下で人数 < 定員 を再確認
-- により、二重割当・定員超過・空ルーム量産が起きない。
--
-- p_assignments: jsonb 配列 [{ "entry_id": uuid, "room_id": uuid }, ...]
-- p_new_rooms:   jsonb 配列 [ [entry_id, entry_id, ...], ... ]（グループごとの entry_id 配列）
create or replace function public.apply_match_plan(
  p_event_id         uuid,
  p_assignments      jsonb,
  p_new_rooms        jsonb,
  p_default_capacity int
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assignment  jsonb;
  v_group       jsonb;
  v_entry_id    uuid;
  v_room_id     uuid;
  v_capacity    int;
  v_count       int;
  v_entry       public.lobby_entries%rowtype;
  v_new_room_id uuid;
  v_claimed     public.lobby_entries[];
  v_first_name  text;
begin
  -- 同一イベントへの適用を直列化（join_room と同じロックドメイン）。
  perform pg_advisory_xact_lock(hashtext('bocchi:event:' || p_event_id::text));

  -- ① 既存ルームへの割当。
  for v_assignment in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    v_entry_id := (v_assignment ->> 'entry_id')::uuid;
    v_room_id  := (v_assignment ->> 'room_id')::uuid;

    -- ルームが今も有効か・定員を確認。
    select r.capacity into v_capacity
    from public.rooms r
    where r.id = v_room_id and r.event_id = p_event_id
      and r.status = 'open' and r.expires_at > now();
    if not found then
      continue;  -- ルームが消えた/期限切れ
    end if;

    select count(*) into v_count from public.room_members where room_id = v_room_id;
    if v_count >= v_capacity then
      continue;  -- 既に満員
    end if;

    -- まだ未マッチのエントリだけを「確保」する（二重割当防止の要）。
    update public.lobby_entries
    set matched_room_id = v_room_id, matched_at = now()
    where id = v_entry_id and event_id = p_event_id and matched_room_id is null
    returning * into v_entry;
    if not found then
      continue;  -- 別の tick が既にマッチ済み
    end if;

    insert into public.room_members (room_id, nickname, x_account, device_id)
    values (v_room_id, v_entry.nickname, v_entry.x_account, v_entry.device_id)
    on conflict (room_id, device_id) do nothing;
  end loop;

  -- ② 新ルームのグループ。
  for v_group in select * from jsonb_array_elements(coalesce(p_new_rooms, '[]'::jsonb))
  loop
    v_claimed := array[]::public.lobby_entries[];

    -- グループ内で今も未マッチのエントリを確保する（定員分まで）。
    for v_entry_id in
      select (e.value)::uuid from jsonb_array_elements_text(v_group) e
    loop
      if array_length(v_claimed, 1) is not null
         and array_length(v_claimed, 1) >= p_default_capacity then
        exit;
      end if;

      update public.lobby_entries
      set matched_at = now()  -- matched_room_id は新ルーム作成後に設定するため一旦保留
      where id = v_entry_id and event_id = p_event_id and matched_room_id is null
      returning * into v_entry;
      if found then
        v_claimed := array_append(v_claimed, v_entry);
      end if;
    end loop;

    -- 2 人以上確保できたときだけ新ルームを作る（1 人なら待機継続に戻す）。
    if array_length(v_claimed, 1) is null or array_length(v_claimed, 1) < 2 then
      -- 確保したが 2 人未満だったエントリは未マッチに戻す。
      if array_length(v_claimed, 1) is not null then
        for i in 1 .. array_length(v_claimed, 1) loop
          update public.lobby_entries
          set matched_at = null
          where id = v_claimed[i].id and matched_room_id is null;
        end loop;
      end if;
      continue;
    end if;

    v_first_name := v_claimed[1].nickname;
    insert into public.rooms (event_id, name, capacity)
    values (p_event_id, v_first_name || 'さんのルーム', p_default_capacity)
    returning id into v_new_room_id;

    for i in 1 .. array_length(v_claimed, 1) loop
      update public.lobby_entries
      set matched_room_id = v_new_room_id, matched_at = now()
      where id = v_claimed[i].id;

      insert into public.room_members (room_id, nickname, x_account, device_id)
      values (v_new_room_id, v_claimed[i].nickname, v_claimed[i].x_account, v_claimed[i].device_id)
      on conflict (room_id, device_id) do nothing;
    end loop;
  end loop;
end;
$$;

grant execute on function public.apply_match_plan(uuid, jsonb, jsonb, int) to service_role;
