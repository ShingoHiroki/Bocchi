import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EventRecord,
  EventRepository,
  SimilarEvent,
} from "@/lib/domain/interfaces/event-repository";
import { normalizeHashtag } from "@/lib/domain/services/normalize-hashtag";

import { getSupabaseServiceRoleClient } from "./client";

/** events テーブルの行（DB のスネークケース）。 */
type EventRow = {
  id: string;
  slug: string;
  display_name: string;
  normalized_name: string;
  created_at: string;
  expires_at: string;
};

function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** URL に使える短いランダム slug を生成する（衝突時は upsert 側でリトライ）。 */
function generateSlug(): string {
  // crypto.randomUUID() の先頭ブロックを流用して 12 文字程度の英数字にする。
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export class SupabaseEventRepository implements EventRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findBySlug(slug: string): Promise<EventRecord | null> {
    const { data, error } = await this.client
      .from("events")
      .select("*")
      .eq("slug", slug)
      .maybeSingle<EventRow>();

    if (error) throw error;
    return data ? toEventRecord(data) : null;
  }

  async findActiveByNormalizedName(normalizedName: string): Promise<EventRecord | null> {
    const { data, error } = await this.client
      .from("events")
      .select("*")
      .eq("normalized_name", normalizedName)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<EventRow>();

    if (error) throw error;
    return data ? toEventRecord(data) : null;
  }

  async upsertByName(displayName: string): Promise<EventRecord> {
    const trimmed = displayName.trim().replace(/^#+/, "");
    const normalizedName = normalizeHashtag(displayName);
    if (normalizedName.length === 0) {
      throw new Error("正規化後のイベント名が空です。イベントを作成できません。");
    }

    // 既に有効な同名イベントがあれば合流（作成しない）。
    const existing = await this.findActiveByNormalizedName(normalizedName);
    if (existing) return existing;

    // slug の衝突に備えて数回リトライする。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await this.client
        .from("events")
        .insert({
          slug: generateSlug(),
          display_name: trimmed.length > 0 ? trimmed : normalizedName,
          normalized_name: normalizedName,
        })
        .select("*")
        .single<EventRow>();

      if (!error && data) return toEventRecord(data);

      // 23505 = unique_violation。slug 衝突ならリトライ、それ以外は投げる。
      if (error && error.code !== "23505") throw error;

      // normalized_name の同時作成競合の可能性もあるため、既存を再確認して合流。
      const raced = await this.findActiveByNormalizedName(normalizedName);
      if (raced) return raced;
    }

    throw new Error("イベントの作成に失敗しました（slug の生成に繰り返し失敗）。");
  }

  async searchSimilar(normalizedName: string, maxResults = 5): Promise<SimilarEvent[]> {
    if (normalizedName.length === 0) return [];

    const { data, error } = await this.client.rpc("search_similar_events", {
      query_normalized: normalizedName,
      max_results: maxResults,
    });

    if (error) throw error;

    type SimilarRow = EventRow & { member_count: number; similarity: number };
    return ((data as SimilarRow[] | null) ?? []).map((row) => ({
      event: toEventRecord(row),
      memberCount: Number(row.member_count),
      similarity: row.similarity,
    }));
  }
}

/** service_role クライアントを使う EventRepository を生成する（サーバー側専用）。 */
export function createEventRepository(): EventRepository {
  return new SupabaseEventRepository(getSupabaseServiceRoleClient());
}
