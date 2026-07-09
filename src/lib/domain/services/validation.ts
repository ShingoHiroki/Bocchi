/**
 * 各画面のバリデーション（docs/screen-flow-design.md の各バリデーション表に準拠）。
 * メッセージ文言は仕様のものをそのまま使う。Supabase 非依存の純粋関数。
 */

import { normalizeHashtag } from "./normalize-hashtag";

/** null を返せば OK、文字列を返せばそれがエラーメッセージ。 */
export type ValidationError = string | null;

/** ニックネーム（SC-001 / SC-008）。必須・20 文字以内・空白のみ不可。 */
export function validateNickname(value: string): ValidationError {
  if (value.length === 0) {
    return "ニックネームを入力してください（未入力です）";
  }
  if (value.trim().length === 0) {
    return "ニックネームに空白以外の文字を入力してください";
  }
  if (value.length > 20) {
    return "ニックネームは 20 文字以内で入力してください";
  }
  return null;
}

/** X アカウント（任意）。半角英数字とアンダースコアのみ・16 文字以内。空は許可。 */
export function validateXAccount(value: string): ValidationError {
  const trimmed = value.trim().replace(/^@+/, "");
  if (trimmed.length === 0) return null;
  if (!/^[A-Za-z0-9_]{1,16}$/.test(trimmed)) {
    return "X のユーザー名は半角英数字とアンダースコア 16 文字以内で入力してください（@ は不要です）";
  }
  return null;
}

/** ハッシュタグ（SC-002）。未入力不可・50 文字以内・正規化後に空でない。 */
export function validateHashtag(value: string): ValidationError {
  if (value.trim().length === 0) {
    return "イベント名（ハッシュタグ）を入力してください";
  }
  if (value.length > 50) {
    return "イベント名は 50 文字以内で入力してください";
  }
  if (normalizeHashtag(value).length === 0) {
    return "使える文字（英数字・かな・漢字など）を含めてください";
  }
  return null;
}

/** ルーム名（SC-005）。任意だが 30 文字以内。 */
export function validateRoomName(value: string): ValidationError {
  if (value.length > 30) {
    return "ルーム名は 30 文字以内で入力してください";
  }
  return null;
}

/** 定員（SC-005）。2〜6 の範囲。 */
export function validateCapacity(value: number): ValidationError {
  if (!Number.isInteger(value) || value < 2 || value > 6) {
    return "定員は 2〜6 人の範囲で選んでください";
  }
  return null;
}

/** チャットのメッセージ本文（SC-007）。空送信不可・500 文字以内・空白のみ不可。 */
export function validateMessageBody(value: string): ValidationError {
  if (value.length === 0) {
    return "メッセージを入力してください";
  }
  if (value.length > 500) {
    return "メッセージは 500 文字以内で入力してください";
  }
  if (value.trim().length === 0) {
    return "メッセージに空白以外の文字を入力してください";
  }
  return null;
}
