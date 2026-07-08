"use client";

import { useSyncExternalStore } from "react";

import { loadProfile, type LocalProfile } from "./profile";

export type ProfileState = {
  /** localStorage 読み取りが完了したか（SSR / ハイドレーション前は false）。 */
  ready: boolean;
  /** ニックネーム設定済みなら値、未設定なら null。 */
  profile: LocalProfile | null;
};

// SSR 用の安定したスナップショット（ハイドレーション一致のため参照を固定する）。
const SERVER_SNAPSHOT: ProfileState = { ready: false, profile: null };

let clientSnapshot: ProfileState = SERVER_SNAPSHOT;
let initialized = false;

function recompute(): void {
  clientSnapshot = { ready: true, profile: loadProfile() };
}

function subscribe(callback: () => void): () => void {
  const handler = () => {
    recompute();
    callback();
  };
  // 他タブでの変更（storage）と、同一タブでの saveProfile 通知の両方を購読する。
  window.addEventListener("storage", handler);
  window.addEventListener("bocchi:profile-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("bocchi:profile-change", handler);
  };
}

function getSnapshot(): ProfileState {
  if (!initialized) {
    initialized = true;
    recompute();
  }
  return clientSnapshot;
}

function getServerSnapshot(): ProfileState {
  return SERVER_SNAPSHOT;
}

/**
 * 端末プロフィールを読み取るクライアントフック（localStorage を外部ストアとして購読）。
 * ハイドレーション前は ready=false。読み取り後に profile が確定する。
 */
export function useProfile(): ProfileState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
