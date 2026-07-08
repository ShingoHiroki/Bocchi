"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * クライアントでハイドレーションが完了したかを返す（SSR 中は false）。
 * window.location など「ブラウザでしか分からない値」を安全に使うためのフック。
 * useSyncExternalStore を使うことで effect 内の setState を避ける。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
