import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  LobbyEntryRecord,
  LobbyRepository,
} from "@/lib/domain/interfaces/lobby-repository";
import type { MatchResult } from "@/lib/domain/services/matching";
import { DEFAULT_ROOM_CAPACITY } from "@/lib/matching-config";

import { getSupabaseServiceRoleClient } from "./client";

type LobbyEntryRow = {
  id: string;
  event_id: string;
  nickname: string;
  x_account: string | null;
  device_id: string;
  entered_at: string;
  matched_room_id: string | null;
};

function toEntryRecord(row: LobbyEntryRow): LobbyEntryRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    nickname: row.nickname,
    xAccount: row.x_account,
    deviceId: row.device_id,
    enteredAt: row.entered_at,
    matchedRoomId: row.matched_room_id,
  };
}

export class SupabaseLobbyRepository implements LobbyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async enqueue(input: {
    eventId: string;
    nickname: string;
    xAccount: string | null;
    deviceId: string;
  }): Promise<LobbyEntryRecord> {
    // 待機し直しを許すため、同一（event, device）の既存エントリを消してから入れ直す。
    // unique(event_id, device_id) があるので、消さずに insert すると衝突する。
    const { error: delError } = await this.client
      .from("lobby_entries")
      .delete()
      .eq("event_id", input.eventId)
      .eq("device_id", input.deviceId);
    if (delError) throw delError;

    const { data, error } = await this.client
      .from("lobby_entries")
      .insert({
        event_id: input.eventId,
        nickname: input.nickname,
        x_account: input.xAccount,
        device_id: input.deviceId,
      })
      .select("*")
      .single<LobbyEntryRow>();
    if (error) throw error;
    return toEntryRecord(data);
  }

  async dequeue(eventId: string, deviceId: string): Promise<void> {
    // 待機中（未マッチ）のエントリのみ削除する。マッチ済みは記録として残す
    // （client が次の tick でマッチ成立を受け取れるようにするため）。
    const { error } = await this.client
      .from("lobby_entries")
      .delete()
      .eq("event_id", eventId)
      .eq("device_id", deviceId)
      .is("matched_room_id", null);
    if (error) throw error;
  }

  async getEntry(eventId: string, deviceId: string): Promise<LobbyEntryRecord | null> {
    const { data, error } = await this.client
      .from("lobby_entries")
      .select("*")
      .eq("event_id", eventId)
      .eq("device_id", deviceId)
      .maybeSingle<LobbyEntryRow>();
    if (error) throw error;
    return data ? toEntryRecord(data) : null;
  }

  async listWaiting(eventId: string): Promise<LobbyEntryRecord[]> {
    const { data, error } = await this.client
      .from("lobby_entries")
      .select("*")
      .eq("event_id", eventId)
      .is("matched_room_id", null)
      .order("entered_at", { ascending: true });
    if (error) throw error;
    return ((data as LobbyEntryRow[] | null) ?? []).map(toEntryRecord);
  }

  async countWaiting(eventId: string): Promise<number> {
    const { count, error } = await this.client
      .from("lobby_entries")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .is("matched_room_id", null);
    if (error) throw error;
    return count ?? 0;
  }

  async applyMatchPlan(eventId: string, plan: MatchResult): Promise<void> {
    if (plan.assignments.length === 0 && plan.newRooms.length === 0) return;

    // 判定結果を DB 関数へ渡し、イベントロック下で原子的に適用する（R3）。
    const assignments = plan.assignments.map((a) => ({
      entry_id: a.entryId,
      room_id: a.roomId,
    }));
    const newRooms = plan.newRooms.map((g) => g.entryIds);

    const { error } = await this.client.rpc("apply_match_plan", {
      p_event_id: eventId,
      p_assignments: assignments,
      p_new_rooms: newRooms,
      p_default_capacity: DEFAULT_ROOM_CAPACITY,
    });
    if (error) throw error;
  }
}

/** service_role クライアントを使う LobbyRepository を生成する（サーバー側専用）。 */
export function createLobbyRepository(): LobbyRepository {
  return new SupabaseLobbyRepository(getSupabaseServiceRoleClient());
}
