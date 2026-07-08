/**
 * イベント（events）へのアクセスを抽象化するインターフェース（Supabase 非依存）。
 * UI・ドメインロジックはこのインターフェース越しにのみデータ操作を行い、
 * adapters/supabase の実装を直接 import しない（CLAUDE.md）。
 */

export type EventRecord = {
  id: string;
  slug: string;
  displayName: string;
  normalizedName: string;
  createdAt: string;
  expiresAt: string;
};

/** 類似イベント候補（SC-003 のサジェスト表示用）。 */
export type SimilarEvent = {
  event: EventRecord;
  /** そのイベント配下のルーム参加者の合計人数。 */
  memberCount: number;
  /** pg_trgm の similarity（0〜1）。並べ替え用。 */
  similarity: number;
};

export interface EventRepository {
  /** 共有 URL 用の slug でイベントを取得する（期限切れ含む。期限判定は呼び出し側）。 */
  findBySlug(slug: string): Promise<EventRecord | null>;

  /** 正規化名で「有効な（期限切れでない）」イベントを取得する。無ければ null。 */
  findActiveByNormalizedName(normalizedName: string): Promise<EventRecord | null>;

  /**
   * 表示名からイベントを upsert する（D2）。
   * 正規化名が有効な既存イベントと一致すればそれを返し（合流）、無ければ新規作成して返す。
   */
  upsertByName(displayName: string): Promise<EventRecord>;

  /** 正規化名に類似する有効なイベントを、類似度の高い順に返す（完全一致は除く）。 */
  searchSimilar(normalizedName: string, maxResults?: number): Promise<SimilarEvent[]>;
}
