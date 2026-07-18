"use server";

/**
 * M1 の Server Actions。ブラウザからは Supabase を直接呼ばず（R2）、
 * ここ（サーバー側）でリポジトリ（interface）越しに DB を操作する。
 * device_id・nickname 等は認証が無いためクライアントから引数で受け取る（D6）。
 */

import { createChatRepository } from "@/lib/adapters/supabase/chat-repository";
import { createEventRepository } from "@/lib/adapters/supabase/event-repository";
import { createLobbyRepository } from "@/lib/adapters/supabase/lobby-repository";
import { createMaintenanceRepository } from "@/lib/adapters/supabase/maintenance-repository";
import { createRoomRepository } from "@/lib/adapters/supabase/room-repository";
import { createTopicCardRepository } from "@/lib/adapters/supabase/topic-card-repository";
import type { ChatRepository } from "@/lib/domain/interfaces/chat-repository";
import type { SimilarEvent } from "@/lib/domain/interfaces/event-repository";
import {
  formatTopicCardMessage,
  SYSTEM_SENDER_NAME,
  SYSTEM_WELCOME_BODY,
  SYSTEM_WELCOME_KIND,
  TOPIC_CARD_SENDER_NAME,
} from "@/lib/domain/services/chat-content";
import { decideMatch } from "@/lib/domain/services/matching";
import { normalizeHashtag } from "@/lib/domain/services/normalize-hashtag";
import {
  validateCapacity,
  validateHashtag,
  validateMessageBody,
  validateRoomName,
} from "@/lib/domain/services/validation";
import { DEFAULT_ROOM_CAPACITY, MATCH_WAIT_THRESHOLD_MS } from "@/lib/matching-config";

function isActive(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() > Date.now();
}

// ── R6: TTL の物理削除（アクセス時のオポチュニスティック削除） ─────────────────
//
// pg_cron / Vercel Cron を使わずローカル完結を保つため（M2 の R4 と同じ判断）、
// 通常アクセス経路（ロビー tick・ルーム一覧取得）から期限切れデータを掃除する。
// 毎回叩くと無駄なので、プロセス内で最短間隔（PURGE_MIN_INTERVAL_MS）に間引く。
// 論理非表示（各クエリの expires_at > now() の WHERE）は維持しているため、
// 削除が多少遅れても期限切れデータがユーザーに見えることはない（掃除は best-effort）。
const PURGE_MIN_INTERVAL_MS = 60_000;
let lastPurgeAtMs = 0;

async function maybePurgeExpired(): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAtMs < PURGE_MIN_INTERVAL_MS) return;
  lastPurgeAtMs = now;
  try {
    await createMaintenanceRepository().purgeExpired();
  } catch {
    // 掃除の失敗は主要機能に影響させない（次の機会に再試行される）。
  }
}

// ── D4: 集合相談を促すシステム初期メッセージをルームに冪等投稿する ─────────────
//
// ルーム作成・参加・マッチ成立の複数経路から呼ばれるが、DB 側の
// (room_id, system_kind) 部分ユニークインデックス + ON CONFLICT DO NOTHING により
// 1 ルームにつき「welcome」は必ず 1 件だけ（並行呼び出しでも安全）。文言は
// domain/services/chat-content.ts（Supabase 非依存）に集約している。
async function ensureWelcomeMessage(chat: ChatRepository, roomId: string): Promise<void> {
  await chat.ensureSystemMessage({
    roomId,
    kind: SYSTEM_WELCOME_KIND,
    senderNickname: SYSTEM_SENDER_NAME,
    body: SYSTEM_WELCOME_BODY,
  });
}

// ── SC-002: ハッシュタグ入力からイベントを解決する ───────────────────────────
export type ResolveEventResult =
  | { status: "invalid"; message: string }
  | { status: "found"; slug: string }
  | {
      status: "not_found";
      displayName: string;
      normalizedPreview: string;
      similar: {
        slug: string;
        displayName: string;
        memberCount: number;
        expiresAt: string;
      }[];
    };

export async function resolveEventByName(rawName: string): Promise<ResolveEventResult> {
  const validationError = validateHashtag(rawName);
  if (validationError) return { status: "invalid", message: validationError };

  const normalized = normalizeHashtag(rawName);
  const events = createEventRepository();

  const existing = await events.findActiveByNormalizedName(normalized);
  if (existing) return { status: "found", slug: existing.slug };

  const similar = await events.searchSimilar(normalized);
  return {
    status: "not_found",
    displayName: rawName.trim().replace(/^#+/, ""),
    normalizedPreview: normalized,
    similar: similar.map((s: SimilarEvent) => ({
      slug: s.event.slug,
      displayName: s.event.displayName,
      memberCount: s.memberCount,
      expiresAt: s.event.expiresAt,
    })),
  };
}

// ── SC-003: 「このまま作る」→ イベントを upsert 作成し slug を返す ─────────────
export type CreateEventResult =
  | { status: "invalid"; message: string }
  | { status: "ok"; slug: string; merged: boolean };

export async function createEvent(rawName: string): Promise<CreateEventResult> {
  const validationError = validateHashtag(rawName);
  if (validationError) return { status: "invalid", message: validationError };

  const events = createEventRepository();
  const normalized = normalizeHashtag(rawName);

  // 作成前に既存の有効イベントがあるか（同名 upsert = 合流）を判定して merged を返す。
  const before = await events.findActiveByNormalizedName(normalized);
  const event = await events.upsertByName(rawName);
  return { status: "ok", slug: event.slug, merged: before !== null };
}

// ── SC-004: ルーム一覧の取得 ──────────────────────────────────────────────
export type EventSummary = {
  id: string;
  slug: string;
  displayName: string;
  expiresAt: string;
};

export type RoomListItem = {
  id: string;
  name: string;
  capacity: number;
  memberCount: number;
  expiresAt: string;
  joined: boolean;
  full: boolean;
};

export type RoomListResult =
  | { status: "not_found" }
  | { status: "expired"; displayName: string }
  | { status: "ok"; event: EventSummary; rooms: RoomListItem[] };

export async function getRoomList(slug: string, deviceId: string): Promise<RoomListResult> {
  // R6: 通常アクセスのタイミングで期限切れデータを物理削除する（間引き済み）。
  await maybePurgeExpired();

  const events = createEventRepository();
  const event = await events.findBySlug(slug);
  if (!event) return { status: "not_found" };
  if (!isActive(event.expiresAt)) return { status: "expired", displayName: event.displayName };

  const rooms = createRoomRepository();
  const [list, joinedIds] = await Promise.all([
    rooms.list(event.id),
    deviceId ? rooms.listJoinedRoomIds(event.id, deviceId) : Promise.resolve<string[]>([]),
  ]);
  const joinedSet = new Set(joinedIds);

  return {
    status: "ok",
    event: {
      id: event.id,
      slug: event.slug,
      displayName: event.displayName,
      expiresAt: event.expiresAt,
    },
    rooms: list.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      memberCount: r.memberCount,
      expiresAt: r.expiresAt,
      joined: joinedSet.has(r.id),
      full: r.memberCount >= r.capacity,
    })),
  };
}

// ── SC-005: ルーム作成（作成者を room_members に追加した状態で返す） ───────────
export type CreateRoomResult =
  | { status: "invalid"; message: string }
  | { status: "event_expired" }
  | { status: "ok"; roomId: string };

export async function createRoom(input: {
  slug: string;
  name: string;
  capacity: number;
  nickname: string;
  xAccount: string;
  deviceId: string;
}): Promise<CreateRoomResult> {
  const nameError = validateRoomName(input.name);
  if (nameError) return { status: "invalid", message: nameError };
  const capacityError = validateCapacity(input.capacity);
  if (capacityError) return { status: "invalid", message: capacityError };

  const events = createEventRepository();
  const event = await events.findBySlug(input.slug);
  if (!event || !isActive(event.expiresAt)) return { status: "event_expired" };

  const rooms = createRoomRepository();
  const room = await rooms.create({
    eventId: event.id,
    name: input.name,
    capacity: input.capacity,
    creator: {
      nickname: input.nickname,
      xAccount: input.xAccount.trim() === "" ? null : input.xAccount.trim(),
      deviceId: input.deviceId,
    },
  });

  // D4: ルーム作成直後にシステム初期メッセージを自動投稿する。
  await ensureWelcomeMessage(createChatRepository(), room.id);

  return { status: "ok", roomId: room.id };
}

// ── SC-004 → SC-007: 既存ルームへの入室 ──────────────────────────────────────
export type JoinRoomActionResult =
  | { status: "joined"; roomId: string }
  | { status: "already_member"; roomId: string }
  | { status: "full" }
  | { status: "not_found" };

export async function joinRoom(input: {
  roomId: string;
  nickname: string;
  xAccount: string;
  deviceId: string;
}): Promise<JoinRoomActionResult> {
  const rooms = createRoomRepository();
  const result = await rooms.join({
    roomId: input.roomId,
    nickname: input.nickname,
    xAccount: input.xAccount.trim() === "" ? null : input.xAccount.trim(),
    deviceId: input.deviceId,
  });

  // D4: 参加できた（既参加含む）ら、システム初期メッセージを冪等に投稿する。
  if (result.status === "joined" || result.status === "already_member") {
    await ensureWelcomeMessage(createChatRepository(), input.roomId);
  }

  if (result.status === "joined") return { status: "joined", roomId: input.roomId };
  if (result.status === "already_member")
    return { status: "already_member", roomId: input.roomId };
  return { status: result.status };
}

// ── SC-006: ロビー待機登録（「ロビーで待つ」） ──────────────────────────────
export type EnterLobbyResult =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "ok"; enteredAt: string };

export async function enterLobby(input: {
  slug: string;
  nickname: string;
  xAccount: string;
  deviceId: string;
}): Promise<EnterLobbyResult> {
  const events = createEventRepository();
  const event = await events.findBySlug(input.slug);
  if (!event) return { status: "not_found" };
  if (!isActive(event.expiresAt)) return { status: "expired" };

  const lobby = createLobbyRepository();
  const entry = await lobby.enqueue({
    eventId: event.id,
    nickname: input.nickname,
    xAccount: input.xAccount.trim() === "" ? null : input.xAccount.trim(),
    deviceId: input.deviceId,
  });
  return { status: "ok", enteredAt: entry.enteredAt };
}

// ── SC-006: ロビー待機の解除（「待機をやめる」「自分でルームを選ぶ」） ──────────
export async function leaveLobby(input: { slug: string; deviceId: string }): Promise<void> {
  const events = createEventRepository();
  const event = await events.findBySlug(input.slug);
  if (!event) return;
  const lobby = createLobbyRepository();
  await lobby.dequeue(event.id, input.deviceId);
}

// ── SC-004: イベントホームでの「この端末のロビー状態」照会 ─────────────────────
//
// lobbyTick と異なり、ここでは decideMatch / applyMatchPlan を呼ばない（照会専用）。
// マッチング判定の実行はロビー画面の tick（R4）の責務のまま維持する。
// waitingCount はこの端末の待機・マッチ状態によらず、ロビーの現在の待機人数を
// 常時表示するために全ステータスへ含める。
export type LobbyStatusResult =
  | { status: "none"; waitingCount: number }
  | { status: "waiting"; waitingCount: number }
  | { status: "matched"; roomId: string; roomName: string; waitingCount: number };

export async function getLobbyStatus(slug: string, deviceId: string): Promise<LobbyStatusResult> {
  const events = createEventRepository();
  const event = await events.findBySlug(slug);
  if (!event || !isActive(event.expiresAt)) return { status: "none", waitingCount: 0 };

  const lobby = createLobbyRepository();
  const [entry, waitingCount] = await Promise.all([
    lobby.getEntry(event.id, deviceId),
    lobby.countWaiting(event.id),
  ]);
  if (!entry) return { status: "none", waitingCount };

  if (entry.matchedRoomId) {
    const rooms = createRoomRepository();
    const room = await rooms.getWithMemberCount(entry.matchedRoomId);
    if (room) return { status: "matched", roomId: room.id, roomName: room.name, waitingCount };
    // 割当先ルームが消えていた場合は表示なし扱い（ロビー画面の tick が次サイクルで整合を取る）。
    return { status: "none", waitingCount };
  }

  return { status: "waiting", waitingCount };
}

// ── SC-006: ロビー tick（マッチング実行＋自分の状態取得） ─────────────────────
//
// R4（トリガー）: Vercel Cron / pg_cron を使わず「クライアント主導」を採る。
// ロビー画面が数秒おきにこの Server Action を呼び、呼ばれるたびにサーバー側で
// マッチング判定（decideMatch）を走らせて適用する。二重実行・二重割当は
// DB のイベントロック（apply_match_plan / join_room）で吸収する（R3）。
//
// R1（リアルタイム更新）: ブラウザから Supabase を直接購読せず（R2 と矛盾するため）、
// この tick が「待機人数・自分の状態」も併せて返すポーリング方式にする。取得は
// LobbyRepository（アダプター層）越しに隔離している。
export type LobbyTickResult =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "not_waiting" }
  | { status: "waiting"; waitingCount: number; enteredAt: string }
  | {
      status: "matched";
      roomId: string;
      roomName: string;
      memberCount: number;
      capacity: number;
    };

export async function lobbyTick(input: {
  slug: string;
  deviceId: string;
}): Promise<LobbyTickResult> {
  // R6: ロビー tick は数秒おきに呼ばれる主要な定期アクセス経路。ここでも期限切れを掃除する（間引き済み）。
  await maybePurgeExpired();

  const events = createEventRepository();
  const event = await events.findBySlug(input.slug);
  if (!event) return { status: "not_found" };
  if (!isActive(event.expiresAt)) return { status: "expired" };

  const lobby = createLobbyRepository();
  const rooms = createRoomRepository();

  // 1) マッチング実行: 待機者と空きルームを読み、純粋関数で判定し、DB へ原子的に適用する。
  const [waiting, openRooms] = await Promise.all([
    lobby.listWaiting(event.id),
    rooms.list(event.id),
  ]);
  const plan = decideMatch(
    waiting.map((e) => ({
      id: e.id,
      deviceId: e.deviceId,
      nickname: e.nickname,
      xAccount: e.xAccount,
      enteredAt: e.enteredAt,
    })),
    openRooms.map((r) => ({ id: r.id, capacity: r.capacity, memberCount: r.memberCount })),
    { waitThresholdMs: MATCH_WAIT_THRESHOLD_MS, defaultCapacity: DEFAULT_ROOM_CAPACITY },
    Date.now(),
  );
  await lobby.applyMatchPlan(event.id, plan);

  // 2) 自分の状態を返す。
  const entry = await lobby.getEntry(event.id, input.deviceId);
  if (!entry) return { status: "not_waiting" };

  if (entry.matchedRoomId) {
    const room = await rooms.getWithMemberCount(entry.matchedRoomId);
    if (room) {
      // D4: マッチ成立（既存ルームへの割当・新ルーム作成の双方）でシステム初期メッセージを冪等投稿。
      await ensureWelcomeMessage(createChatRepository(), room.id);
      return {
        status: "matched",
        roomId: room.id,
        roomName: room.name,
        memberCount: room.memberCount,
        capacity: room.capacity,
      };
    }
    // 割当先ルームが消えていた場合は待機扱いに戻す（次サイクルで再判定）。
  }

  const waitingCount = await lobby.countWaiting(event.id);
  return { status: "waiting", waitingCount, enteredAt: entry.enteredAt };
}

// ── SC-007: ルームチャット ────────────────────────────────────────────────────
//
// R1（リアルタイム更新）: ブラウザから Supabase を直接購読せず（R2 と矛盾するため）、
// クライアントが一定間隔で pollRoomMessages を呼ぶポーリング方式で複数端末を同期する。
// 取得は ChatRepository（アダプター層）越しに隔離し、将来 Realtime へ差し替え可能にする。

export type ChatMessage = {
  id: string;
  senderType: "system" | "user";
  senderNickname: string;
  body: string;
  createdAt: string;
  /** この端末（自分）の発言か。右寄せ表示に使う。 */
  mine: boolean;
};

export type RoomChatResult =
  | { status: "not_found" }
  | { status: "expired" }
  | {
      status: "ok";
      room: { name: string; capacity: number; memberCount: number; expiresAt: string };
      members: { nickname: string; xAccount: string | null }[];
      messages: ChatMessage[];
      /** この端末が当該ルームの参加者か（URL 直開き時の判定用）。 */
      isMember: boolean;
    };

function toChatMessages(
  messages: { senderType: "system" | "user"; senderNickname: string; body: string; createdAt: string; senderDeviceId: string | null; id: string }[],
  deviceId: string,
): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    senderType: m.senderType,
    senderNickname: m.senderNickname,
    body: m.body,
    createdAt: m.createdAt,
    mine: m.senderType === "user" && m.senderDeviceId === deviceId,
  }));
}

/** 初回ロード: システム初期メッセージを保証しつつ、ルーム・メンバー・メッセージを返す（SC-007）。 */
export async function getRoomChat(roomId: string, deviceId: string): Promise<RoomChatResult> {
  const rooms = createRoomRepository();
  const room = await rooms.getWithMemberCount(roomId);
  if (!room) return { status: "not_found" };
  if (!isActive(room.expiresAt)) return { status: "expired" };

  const chat = createChatRepository();
  // D4: URL 直開き・新ルーム作成直後など、いずれの経路でも初期メッセージが必ず 1 件見えるよう保証する。
  await ensureWelcomeMessage(chat, roomId);

  const [members, messages] = await Promise.all([
    rooms.listMembers(roomId),
    chat.listMessages(roomId),
  ]);

  return {
    status: "ok",
    room: {
      name: room.name,
      capacity: room.capacity,
      memberCount: room.memberCount,
      expiresAt: room.expiresAt,
    },
    members: members.map((m) => ({ nickname: m.nickname, xAccount: m.xAccount })),
    messages: toChatMessages(messages, deviceId),
    isMember: members.some((m) => m.deviceId === deviceId),
  };
}

/** ポーリング取得: メッセージ一覧と現在人数だけを軽量に返す（複数端末同期）。 */
export type PollRoomResult =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "ok"; memberCount: number; messages: ChatMessage[] };

export async function pollRoomMessages(
  roomId: string,
  deviceId: string,
): Promise<PollRoomResult> {
  const rooms = createRoomRepository();
  const room = await rooms.getWithMemberCount(roomId);
  if (!room) return { status: "not_found" };
  if (!isActive(room.expiresAt)) return { status: "expired" };

  const chat = createChatRepository();
  const messages = await chat.listMessages(roomId);
  return {
    status: "ok",
    memberCount: room.memberCount,
    messages: toChatMessages(messages, deviceId),
  };
}

/** メッセージ投稿（バリデーション: 空送信不可・500 文字以内・空白のみ不可）。 */
export type PostMessageResult =
  | { status: "invalid"; message: string }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "ok"; message: ChatMessage };

export async function postRoomMessage(input: {
  roomId: string;
  nickname: string;
  deviceId: string;
  body: string;
}): Promise<PostMessageResult> {
  const bodyError = validateMessageBody(input.body);
  if (bodyError) return { status: "invalid", message: bodyError };

  const rooms = createRoomRepository();
  const room = await rooms.getWithMemberCount(input.roomId);
  if (!room) return { status: "not_found" };
  if (!isActive(room.expiresAt)) return { status: "expired" };

  const chat = createChatRepository();
  const posted = await chat.postMessage({
    roomId: input.roomId,
    senderNickname: input.nickname,
    senderDeviceId: input.deviceId,
    body: input.body.trim(),
  });

  return {
    status: "ok",
    message: {
      id: posted.id,
      senderType: posted.senderType,
      senderNickname: posted.senderNickname,
      body: posted.body,
      createdAt: posted.createdAt,
      mine: true,
    },
  };
}

/** 退室（OV-02 の OK）。room_members から自分を除去する（冪等）。 */
export async function leaveRoom(input: { roomId: string; deviceId: string }): Promise<void> {
  const rooms = createRoomRepository();
  await rooms.leave(input.roomId, input.deviceId);
}

// ── OV-04: 話題カード（アイスブレイクのお題） ─────────────────────────────────
//
// SC-007「話題カードを引く」→ OV-04 でランダムなお題を表示 →「別のお題を引く」/「みんなに送る」。
// 取得は TopicCardRepository（アダプター層）越しに行い、ランダム抽出は DB 関数に閉じ込める。

export type TopicCard = {
  id: string;
  category: "tech" | "general";
  promptText: string;
};

/** ランダムにお題を 1 件引く。excludeId を渡すと直前のお題を避ける（「別のお題を引く」）。 */
export async function drawTopicCard(excludeId?: string): Promise<TopicCard | null> {
  const topics = createTopicCardRepository();
  const card = await topics.getRandom(excludeId);
  if (!card) return null;
  return { id: card.id, category: card.category, promptText: card.promptText };
}

/** お題を「みんなに送る」= チャットへシステム風メッセージとして投稿する（OV-04）。 */
export type SendTopicCardResult =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "ok"; message: ChatMessage };

export async function sendTopicCard(input: {
  roomId: string;
  promptText: string;
}): Promise<SendTopicCardResult> {
  const rooms = createRoomRepository();
  const room = await rooms.getWithMemberCount(input.roomId);
  if (!room) return { status: "not_found" };
  if (!isActive(room.expiresAt)) return { status: "expired" };

  const chat = createChatRepository();
  const posted = await chat.postSystemMessage({
    roomId: input.roomId,
    senderNickname: TOPIC_CARD_SENDER_NAME,
    body: formatTopicCardMessage(input.promptText),
  });

  return {
    status: "ok",
    message: {
      id: posted.id,
      senderType: posted.senderType,
      senderNickname: posted.senderNickname,
      body: posted.body,
      createdAt: posted.createdAt,
      mine: false,
    },
  };
}
