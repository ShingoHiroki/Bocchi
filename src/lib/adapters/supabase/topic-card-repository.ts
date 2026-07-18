import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  TopicCardCategory,
  TopicCardRecord,
  TopicCardRepository,
} from "@/lib/domain/interfaces/topic-card-repository";

import { getSupabaseServiceRoleClient } from "./client";

type TopicCardRow = {
  id: string;
  category: TopicCardCategory;
  prompt_text: string;
};

function toRecord(row: TopicCardRow): TopicCardRecord {
  return { id: row.id, category: row.category, promptText: row.prompt_text };
}

export class SupabaseTopicCardRepository implements TopicCardRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getRandom(excludeId?: string): Promise<TopicCardRecord | null> {
    // ランダム抽出は DB 関数 get_random_topic_card に閉じ込める（order by random()）。
    // p_exclude_id を渡すと直前のお題を除外して引ける（「別のお題を引く」の連続回避）。
    const { data, error } = await this.client.rpc("get_random_topic_card", {
      p_exclude_id: excludeId ?? null,
    });
    if (error) throw error;

    const rows = (data as TopicCardRow[] | null) ?? [];
    return rows.length > 0 ? toRecord(rows[0]) : null;
  }
}

/** service_role クライアントを使う TopicCardRepository を生成する（サーバー側専用）。 */
export function createTopicCardRepository(): TopicCardRepository {
  return new SupabaseTopicCardRepository(getSupabaseServiceRoleClient());
}
