"use server";

/**
 * M1 の Server Actions。ブラウザからは Supabase を直接呼ばず（R2）、
 * ここ（サーバー側）でリポジトリ（interface）越しに DB を操作する。
 * device_id・nickname 等は認証が無いためクライアントから引数で受け取る（D6）。
 */

import { createEventRepository } from "@/lib/adapters/supabase/event-repository";
import { createRoomRepository } from "@/lib/adapters/supabase/room-repository";
import type { SimilarEvent } from "@/lib/domain/interfaces/event-repository";
import { normalizeHashtag } from "@/lib/domain/services/normalize-hashtag";
import {
  validateCapacity,
  validateHashtag,
  validateRoomName,
} from "@/lib/domain/services/validation";

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
