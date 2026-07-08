import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreateRoomInput,
  JoinRoomInput,
  JoinRoomResult,
  RoomMemberRecord,
  RoomRecord,
  RoomRepository,
  RoomWithMemberCount,
} from "@/lib/domain/interfaces/room-repository";

import { getSupabaseServiceRoleClient } from "./client";

type RoomRow = {
  id: string;
  event_id: string;
  name: string;
  capacity: number;
  status: string;
  created_at: string;
  expires_at: string;
};

type RoomMemberRow = {
  id: string;
  room_id: string;
  nickname: string;
  x_account: string | null;
  device_id: string;
  joined_at: string;
};

function toRoomRecord(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function toMemberRecord(row: RoomMemberRow): RoomMemberRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    nickname: row.nickname,
    xAccount: row.x_account,
    deviceId: row.device_id,
    joinedAt: row.joined_at,
  };
}

export class SupabaseRoomRepository implements RoomRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** 指定ルーム群の現在人数を room_id => count で返す。 */
  private async countMembers(roomIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (roomIds.length === 0) return counts;

    const { data, error } = await this.client
      .from("room_members")
      .select("room_id")
      .in("room_id", roomIds);
    if (error) throw error;

    for (const row of (data as { room_id: string }[] | null) ?? []) {
      counts.set(row.room_id, (counts.get(row.room_id) ?? 0) + 1);
    }
    return counts;
  }

  async list(eventId: string): Promise<RoomWithMemberCount[]> {
    const { data, error } = await this.client
      .from("rooms")
      .select("*")
      .eq("event_id", eventId)
      .eq("status", "open")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    if (error) throw error;

    const rooms = ((data as RoomRow[] | null) ?? []).map(toRoomRecord);
    const counts = await this.countMembers(rooms.map((r) => r.id));

    const withCount: RoomWithMemberCount[] = rooms.map((room) => ({
      ...room,
      memberCount: counts.get(room.id) ?? 0,
    }));

    // 空きあり（人数 < 定員）を上位に、その中では作成が古い順に並べる（SC-004）。
    return withCount.sort((a, b) => {
      const aOpen = a.memberCount < a.capacity ? 0 : 1;
      const bOpen = b.memberCount < b.capacity ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  async create(input: CreateRoomInput): Promise<RoomRecord> {
    const name = input.name.trim();
    const finalName = name.length > 0 ? name : `${input.creator.nickname}さんのルーム`;

    const { data: roomData, error: roomError } = await this.client
      .from("rooms")
      .insert({
        event_id: input.eventId,
        name: finalName,
        capacity: input.capacity,
      })
      .select("*")
      .single<RoomRow>();
    if (roomError) throw roomError;

    const { error: memberError } = await this.client.from("room_members").insert({
      room_id: roomData.id,
      nickname: input.creator.nickname,
      x_account: input.creator.xAccount,
      device_id: input.creator.deviceId,
    });
    if (memberError) throw memberError;

    return toRoomRecord(roomData);
  }

  async join(input: JoinRoomInput): Promise<JoinRoomResult> {
    const { data: roomData, error: roomError } = await this.client
      .from("rooms")
      .select("*")
      .eq("id", input.roomId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle<RoomRow>();
    if (roomError) throw roomError;
    if (!roomData) return { status: "not_found" };

    // 既に参加済み（同一 device_id）なら冪等に成功扱い。
    const { data: existing, error: existingError } = await this.client
      .from("room_members")
      .select("*")
      .eq("room_id", input.roomId)
      .eq("device_id", input.deviceId)
      .maybeSingle<RoomMemberRow>();
    if (existingError) throw existingError;
    if (existing) return { status: "already_member", member: toMemberRecord(existing) };

    // 定員チェック（M1 は素朴な check-then-insert。厳密な競合制御は M2 / R3）。
    const counts = await this.countMembers([input.roomId]);
    if ((counts.get(input.roomId) ?? 0) >= roomData.capacity) {
      return { status: "full" };
    }

    const { data: inserted, error: insertError } = await this.client
      .from("room_members")
      .insert({
        room_id: input.roomId,
        nickname: input.nickname,
        x_account: input.xAccount,
        device_id: input.deviceId,
      })
      .select("*")
      .single<RoomMemberRow>();

    if (insertError) {
      // unique(room_id, device_id) 競合＝ほぼ同時の二重参加。既参加として扱う。
      if (insertError.code === "23505") {
        const { data: raced } = await this.client
          .from("room_members")
          .select("*")
          .eq("room_id", input.roomId)
          .eq("device_id", input.deviceId)
          .maybeSingle<RoomMemberRow>();
        if (raced) return { status: "already_member", member: toMemberRecord(raced) };
      }
      throw insertError;
    }

    return { status: "joined", member: toMemberRecord(inserted) };
  }

  async getWithMemberCount(roomId: string): Promise<RoomWithMemberCount | null> {
    const { data, error } = await this.client
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .maybeSingle<RoomRow>();
    if (error) throw error;
    if (!data) return null;

    const counts = await this.countMembers([roomId]);
    return { ...toRoomRecord(data), memberCount: counts.get(roomId) ?? 0 };
  }

  async listMembers(roomId: string): Promise<RoomMemberRecord[]> {
    const { data, error } = await this.client
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    return ((data as RoomMemberRow[] | null) ?? []).map(toMemberRecord);
  }

  async listJoinedRoomIds(eventId: string, deviceId: string): Promise<string[]> {
    // 当該イベント配下のルーム id を取得してから、その中で自分が参加している room_id を絞り込む。
    const { data: rooms, error: roomsError } = await this.client
      .from("rooms")
      .select("id")
      .eq("event_id", eventId);
    if (roomsError) throw roomsError;

    const roomIds = ((rooms as { id: string }[] | null) ?? []).map((r) => r.id);
    if (roomIds.length === 0) return [];

    const { data, error } = await this.client
      .from("room_members")
      .select("room_id")
      .eq("device_id", deviceId)
      .in("room_id", roomIds);
    if (error) throw error;

    return ((data as { room_id: string }[] | null) ?? []).map((r) => r.room_id);
  }
}

/** service_role クライアントを使う RoomRepository を生成する（サーバー側専用）。 */
export function createRoomRepository(): RoomRepository {
  return new SupabaseRoomRepository(getSupabaseServiceRoleClient());
}
