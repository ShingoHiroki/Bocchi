/**
 * ルームチャット（messages）へのアクセスを抽象化するインターフェース（Supabase 非依存）。
 * UI・ドメインロジックはこのインターフェース越しにのみデータ操作を行い、
 * adapters/supabase の実装を直接 import しない（CLAUDE.md）。
 *
 * 実装計画 4 節の想定インターフェース: ChatRepository { listMessages(), postMessage() }。
 * 本実装では加えて、システム初期メッセージを冪等に投稿する ensureSystemMessage() を持つ
 * （D4: マッチ成立・ルーム作成/参加時の自動投稿。重複投稿を防ぐため 1 ルーム 1 件に制限）。
 */

export type MessageSenderType = "system" | "user";

export type MessageRecord = {
  id: string;
  roomId: string;
  senderType: MessageSenderType;
  /** 送信者の端末識別子（本人＝自分の右寄せ表示に使う）。system メッセージでは null。 */
  senderDeviceId: string | null;
  senderNickname: string;
  body: string;
  createdAt: string;
};

export type PostMessageInput = {
  roomId: string;
  senderNickname: string;
  senderDeviceId: string;
  body: string;
};

export interface ChatRepository {
  /** ルームのメッセージを作成が古い順（created_at 昇順）で返す。 */
  listMessages(roomId: string): Promise<MessageRecord[]>;

  /** ユーザーのメッセージを投稿し、作成された 1 件を返す。 */
  postMessage(input: PostMessageInput): Promise<MessageRecord>;

  /**
   * システム風のメッセージを投稿し、作成された 1 件を返す（話題カードの「みんなに送る」= OV-04）。
   * ensureSystemMessage（1 ルーム 1 件の welcome）と異なり、こちらは何件でも投稿できる
   * （system_kind を持たないため重複防止インデックスの対象外）。中央寄せのシステム表示になる。
   */
  postSystemMessage(input: {
    roomId: string;
    senderNickname: string;
    body: string;
  }): Promise<MessageRecord>;

  /**
   * システムメッセージを冪等に投稿する（D4）。同一ルーム・同一種別（kind）は 1 件だけ入る。
   * ルーム作成・参加・マッチ成立の複数経路から何度呼ばれても重複しない。
   */
  ensureSystemMessage(input: {
    roomId: string;
    kind: string;
    senderNickname: string;
    body: string;
  }): Promise<void>;
}
