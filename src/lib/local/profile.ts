/**
 * 端末ローカルのプロフィール保存（localStorage）。認証なしのため、
 * ニックネーム・任意の X アカウント・端末識別子 device_id をここで管理する（D6）。
 *
 * この処理はブラウザ（クライアントコンポーネント）でのみ動作する。
 * localStorage が使えない場合（プライベートブラウズ等）は例外を投げず、
 * セッション内メモリの暫定値で続行できるようフォールバックする（SC-001 のエラー状態）。
 */

export type LocalProfile = {
  nickname: string;
  xAccount: string; // "" のとき未設定
  deviceId: string;
};

const NICKNAME_KEY = "bocchi.profile.nickname";
const X_ACCOUNT_KEY = "bocchi.profile.x_account";
const DEVICE_ID_KEY = "bocchi.profile.device_id";

/** localStorage が使えないときの暫定保存先（セッション内メモリ）。 */
const memoryStore: Record<string, string> = {};
let storageUsable = true;

function safeGet(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value;
  } catch {
    storageUsable = false;
    return key in memoryStore ? memoryStore[key] : null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    storageUsable = false;
    memoryStore[key] = value;
  }
}

/** localStorage が使用可能かどうか（SC-001 / SC-008 のエラー表示に使う）。 */
export function isStorageUsable(): boolean {
  return storageUsable;
}

/** device_id を取得（未発行なら crypto.randomUUID() で発行して保存）する。 */
export function ensureDeviceId(): string {
  const existing = safeGet(DEVICE_ID_KEY);
  if (existing && existing.length > 0) return existing;

  const deviceId = globalThis.crypto.randomUUID();
  safeSet(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

/** 保存済みプロフィールを読む。ニックネーム未設定なら null。 */
export function loadProfile(): LocalProfile | null {
  const nickname = safeGet(NICKNAME_KEY);
  if (!nickname || nickname.trim().length === 0) return null;

  return {
    nickname,
    xAccount: safeGet(X_ACCOUNT_KEY) ?? "",
    deviceId: ensureDeviceId(),
  };
}

/** ニックネームが設定済みか。 */
export function hasProfile(): boolean {
  return loadProfile() !== null;
}

/** プロフィールを保存する（device_id は未発行なら発行）。保存後の値を返す。 */
export function saveProfile(input: { nickname: string; xAccount: string }): LocalProfile {
  const nickname = input.nickname.trim();
  const xAccount = input.xAccount.trim();

  safeSet(NICKNAME_KEY, nickname);
  safeSet(X_ACCOUNT_KEY, xAccount);
  const deviceId = ensureDeviceId();

  // 同一タブの useProfile（useSyncExternalStore）へ変更を通知する。
  try {
    window.dispatchEvent(new Event("bocchi:profile-change"));
  } catch {
    // window が無い環境（SSR）では何もしない。
  }

  return { nickname, xAccount, deviceId };
}
