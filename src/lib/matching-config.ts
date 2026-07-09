/**
 * ロビー自動マッチ（M2）の調整可能パラメータを 1 箇所に集約する。
 * 実地検証で調整しやすいよう、しきい値・間隔・定員はここだけを直せばよい状態にする
 * （docs/interview-decisions.md の仮置き値: 待機 60〜90 秒・既定定員 3 人）。
 *
 * このファイルは純粋な定数のみ（Supabase 非依存）。クライアント・サーバー双方から import してよい。
 */

/** 待機がこの時間を超えたエントリをマッチング対象にする（仮値: 60 秒）。 */
export const MATCH_WAIT_THRESHOLD_MS = 60_000;

/** 待機時間の目安の上限（表示用。60〜90 秒のうちの上限）。 */
export const MATCH_WAIT_TARGET_MAX_MS = 90_000;

/** クライアントがロビーで tick（マッチ実行＋状態取得）を呼ぶ間隔（仮値: 5 秒）。 */
export const LOBBY_TICK_INTERVAL_MS = 5_000;

/** ロビー発の新規ルームの既定定員（D5: 既定 3 人）。 */
export const DEFAULT_ROOM_CAPACITY = 3;

/**
 * ルームチャット（SC-007・M3）でメッセージ一覧をポーリング取得する間隔（仮値: 3 秒）。
 * 複数端末間の同期に使う（R1: ブラウザから Supabase を直接購読せず、Server Action 経由で取得）。
 */
export const ROOM_MESSAGES_POLL_INTERVAL_MS = 3_000;
