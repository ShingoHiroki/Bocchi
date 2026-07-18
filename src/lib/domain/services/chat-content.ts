/**
 * ルームチャットの「文言」（システム初期メッセージ・クイック返信候補）を集約する。
 * Supabase 非依存の純粋な定数のみ。文言は docs/screen-flow-design.md SC-007 に準拠する。
 *
 * システムメッセージの本文をここ（TS のドメイン層）に置くことで、
 * DB マイグレーションに UI 文言を埋め込まず、アダプター層越しに投稿できる（D8 の移植性方針）。
 */

/** システム自動投稿の種別。ルームごとに 1 件だけ（重複防止の識別子）。 */
export const SYSTEM_WELCOME_KIND = "welcome";

/** システムメッセージの送信者表示名。 */
export const SYSTEM_SENDER_NAME = "システム";

/**
 * マッチ成立・ルーム参加直後に自動投稿する初期メッセージ（D4）。
 * 「チャットで止まる」対策として、集合場所の相談を促す（screen-flow-design.md 4.4）。
 */
export const SYSTEM_WELCOME_BODY =
  "ようこそ！ここで集合場所を決めて合流しましょう。今どのあたりにいますか？下のボタンからも返信できます。";

/**
 * システム初期メッセージに紐づくクイック返信候補（1 タップ送信）。
 * screen-flow-design.md SC-007 の例に準拠。
 */
export const QUICK_REPLIES: readonly string[] = [
  "入口の近くにいます",
  "今どのあたり？",
  "テーブル番号は？",
  "すぐ行きます",
];

/** 話題カードを「みんなに送る」で共有したときのチャット上の送信者表示名（OV-04）。 */
export const TOPIC_CARD_SENDER_NAME = "話題カード";

/**
 * 話題カードをチャットへ共有するときの本文フォーマット（OV-04）。
 * システム初期メッセージ（welcome）と見分けられるよう先頭にカードの目印を付ける。
 */
export function formatTopicCardMessage(promptText: string): string {
  return `🃏 話題カード：${promptText}`;
}
