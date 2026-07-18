-- M4: TTL の物理削除（R6）
-- 作成から 24 時間で期限切れになった events / rooms を実際に DELETE する関数を定義する。
--
-- 設計方針（docs/implementation-plan.md 7 節 R6、CLAUDE.md、docs/interview-decisions.md D7）:
--  * 採用方式 = 「アクセス時のオポチュニスティック削除」。
--    ローカル完結（supabase start + npm run dev だけで動く）を最優先するため、pg_cron / Vercel Cron は使わない。
--    M2 の R4（マッチング実行トリガー）でも同じ理由で pg_cron を見送り「クライアント主導 tick」を採用しており、
--    その設計判断と整合させる。ロビー tick・ルーム一覧取得などの通常アクセス経路から、
--    アプリ側（actions.ts）で間引き（スロットル）しつつ purge_expired() を呼ぶ。
--  * 既存の「expires_at > now() の WHERE による論理非表示」は維持する（本関数は物理削除を追加するだけ）。
--    論理非表示があるため、削除が多少遅れても期限切れデータがユーザーに見えることはない。
--  * 巻き添え防止: 削除条件は expires_at のみ。FK の ON DELETE CASCADE
--    （rooms→events / room_members→rooms / messages→rooms / lobby_entries→events）により、
--    期限切れの親に紐づく子だけが連鎖削除される。他イベント・他ルームのデータは巻き込まれない。

-- ── purge_expired: 期限切れの rooms / events を物理削除する（削除件数を返す） ─────
-- 手順:
--  1) 期限切れの rooms を削除（イベントは有効だがルームだけ先に切れたケースに対応。
--     room_members / messages は CASCADE で連鎖削除される）。
--  2) 期限切れの events を削除（配下の rooms・room_members・messages・lobby_entries が
--     CASCADE で連鎖削除される。期限切れイベント配下は、まだ期限内のルームも含めてすべて閉じる）。
-- deleted_rooms は 1) で直接削除したルーム数、deleted_events は 2) で削除したイベント数
-- （CASCADE で連鎖削除された分は数えない。あくまで観測・検証用のざっくりした件数）。
create or replace function public.purge_expired()
returns table (
  deleted_rooms  integer,
  deleted_events integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rooms  integer;
  v_events integer;
begin
  with deleted as (
    delete from public.rooms
    where expires_at <= now()
    returning 1
  )
  select count(*) into v_rooms from deleted;

  with deleted as (
    delete from public.events
    where expires_at <= now()
    returning 1
  )
  select count(*) into v_events from deleted;

  return query select v_rooms, v_events;
end;
$$;

grant execute on function public.purge_expired() to service_role;
