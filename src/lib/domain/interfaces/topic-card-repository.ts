/**
 * 話題カード（topic_cards）へのアクセスを抽象化するインターフェース（Supabase 非依存）。
 * UI・ドメインロジックはこのインターフェース越しにのみデータ操作を行い、
 * adapters/supabase の実装を直接 import しない（CLAUDE.md）。
 *
 * 実装計画 4 節の主要テーブル案: topic_cards { id, category, prompt_text }。
 * お題は固定リストからのランダム提示に留める（実装計画 10 節・D7）。
 */

export type TopicCardCategory = "tech" | "general";

export type TopicCardRecord = {
  id: string;
  category: TopicCardCategory;
  promptText: string;
};

export interface TopicCardRepository {
  /**
   * ランダムにお題を 1 件返す（SC-007「話題カードを引く」/ OV-04）。
   * excludeId を渡すと、そのお題を除外して抽選する（「別のお題を引く」で連続を避けるため）。
   * お題が 0 件のときは null を返す。
   */
  getRandom(excludeId?: string): Promise<TopicCardRecord | null>;
}
