import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ChatRepository,
  MessageRecord,
  MessageSenderType,
  PostMessageInput,
} from "@/lib/domain/interfaces/chat-repository";

import { getSupabaseServiceRoleClient } from "./client";

type MessageRow = {
  id: string;
  room_id: string;
  sender_type: MessageSenderType;
  system_kind: string | null;
  sender_device_id: string | null;
  sender_nickname: string;
  body: string;
  created_at: string;
};

function toMessageRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    senderType: row.sender_type,
    senderDeviceId: row.sender_device_id,
    senderNickname: row.sender_nickname,
    body: row.body,
    createdAt: row.created_at,
  };
}

export class SupabaseChatRepository implements ChatRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listMessages(roomId: string): Promise<MessageRecord[]> {
    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data as MessageRow[] | null) ?? []).map(toMessageRecord);
  }

  async postMessage(input: PostMessageInput): Promise<MessageRecord> {
    const { data, error } = await this.client
      .from("messages")
      .insert({
        room_id: input.roomId,
        sender_type: "user",
        sender_device_id: input.senderDeviceId,
        sender_nickname: input.senderNickname,
        body: input.body,
      })
      .select("*")
      .single<MessageRow>();
    if (error) throw error;
    return toMessageRecord(data);
  }

  async ensureSystemMessage(input: {
    roomId: string;
    kind: string;
    senderNickname: string;
    body: string;
  }): Promise<void> {
    // 冪等な投稿（重複防止・D4）は DB 関数 ensure_system_message に閉じ込める。
    // (room_id, system_kind) の部分ユニークインデックス + ON CONFLICT DO NOTHING により、
    // 複数経路（ルーム作成・参加・マッチ成立）から何度呼ばれても 1 ルーム 1 件になる。
    const { error } = await this.client.rpc("ensure_system_message", {
      p_room_id: input.roomId,
      p_kind: input.kind,
      p_nickname: input.senderNickname,
      p_body: input.body,
    });
    if (error) throw error;
  }
}

/** service_role クライアントを使う ChatRepository を生成する（サーバー側専用）。 */
export function createChatRepository(): ChatRepository {
  return new SupabaseChatRepository(getSupabaseServiceRoleClient());
}
