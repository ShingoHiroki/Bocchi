"use server";

/**
 * M1 の Server Actions。ブラウザからは Supabase を直接呼ばず（R2）、
 * ここ（サーバー側）でリポジトリ（interface）越しに DB を操作する。
 * device_id・nickname 等は認証が無いためクライアントから引数で受け取る（D6）。
 */

import { createEventRepository } from "@/lib/adapters/supabase/event-repository";
import { createLobbyRepository } from "@/lib/adapters/supabase/lobby-repository";
import { createRoomRepository } from "@/lib/adapters/supabase/room-repository";
import type { SimilarEvent } from "@/lib/domain/interfaces/event-repository";
import { decideMatch } from "@/lib/domain/services/matching";
import { normalizeHashtag } from "@/lib/domain/services/normalize-hashtag";
import {
  validateCapacity,
  validateHashtag,
  validateRoomName,
} from "@/lib/domain/services/validation";
import { DEFAULT_ROOM_CAPACITY, MATCH_WAIT_THRESHOLD_MS } from "@/lib/matching-config";

function isActive(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() > Date.now();
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

  if (result.status === "joined") return { status: "joined", roomId: input.roomId };
  if (result.status === "already_member")
    return { status: "already_member", roomId: input.roomId };
  return { status: result.status };
}

// ── SC-007: ルーム詳細（M1 はプレースホルダ表示用。ルーム名＋メンバー一覧） ─────
export type RoomDetailResult =
  | { status: "not_found" }
  | { status: "expired" }
  | {
      status: "ok";
      room: { name: string; capacity: number; memberCount: number; expiresAt: string };
      members: { nickname: string; xAccount: string | null }[];
    };

export async function getRoomDetail(roomId: string): Promise<RoomDetailResult> {
  const rooms = createRoomRepository();
  const room = await rooms.getWithMemberCount(roomId);
  if (!room) return { status: "not_found" };
  if (!isActive(room.expiresAt)) return { status: "expired" };

  const members = await rooms.listMembers(roomId);
  return {
    status: "ok",
    room: {
      name: room.name,
      capacity: room.capacity,
      memberCount: room.memberCount,
      expiresAt: room.expiresAt,
    },
    members: members.map((m) => ({ nickname: m.nickname, xAccount: m.xAccount })),
  };
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
