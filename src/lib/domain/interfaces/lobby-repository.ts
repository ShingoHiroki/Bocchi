/**
 * ロビー待機（lobby_entries）へのアクセスを抽象化するインターフェース（Supabase 非依存）。
 * UI・ドメインロジックはこのインターフェース越しにのみデータ操作を行い、
 * adapters/supabase の実装を直接 import しない（CLAUDE.md）。
 *
 * マッチングの「判定」は domain/services の decideMatch（純粋関数）が行い、
 * その結果（プラン）の「適用」だけをここ（アダプター＝DB）に委ねる。
 */

import type { MatchResult } from "@/lib/domain/services/matching";

export type LobbyEntryRecord = {
  id: string;
  eventId: string;
  nickname: string;
  xAccount: string | null;
  deviceId: string;
  enteredAt: string;
  /** マッチ済みなら割当先ルーム id、待機中なら null。 */
  matchedRoomId: string | null;
};

export interface LobbyRepository {
  /**
   * ロビーに待機登録する（冪等）。同一端末の既存エントリがあれば作り直して待機し直す。
   * 返り値は登録後のエントリ。
   */
  enqueue(input: {
    eventId: string;
    nickname: string;
    xAccount: string | null;
    deviceId: string;
  }): Promise<LobbyEntryRecord>;

  /** ロビー待機を解除する（「待機をやめる」）。 */
  dequeue(eventId: string, deviceId: string): Promise<void>;

  /** 指定端末の現在のエントリを取得する（無ければ null）。マッチ済みかの判定にも使う。 */
  getEntry(eventId: string, deviceId: string): Promise<LobbyEntryRecord | null>;

  /** 待機中（未マッチ）のエントリ一覧。decideMatch の入力。 */
  listWaiting(eventId: string): Promise<LobbyEntryRecord[]>;

  /** 待機中（未マッチ）の人数。ロビー画面の表示用。 */
  countWaiting(eventId: string): Promise<number>;

  /**
   * decideMatch が決めたプランを原子的に適用する（二重割当・定員超過を DB で防ぐ）。
   * 並行呼び出しに耐えるよう、適用はイベント単位で直列化される（実装＝DB 関数）。
   */
  applyMatchPlan(eventId: string, plan: MatchResult): Promise<void>;
}
