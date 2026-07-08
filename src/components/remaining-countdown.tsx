"use client";

import { useEffect, useState } from "react";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 残りミリ秒を「あと HH:MM:SS」に整形する。0 以下なら「期限切れ」。 */
function remainingLabel(expiresAt: string, nowMs: number): string {
  const ms = new Date(expiresAt).getTime() - nowMs;
  if (ms <= 0) return "期限切れ";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `あと ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/**
 * 残り有効時間を「あと HH:MM:SS」で 1 秒ごとに更新表示するクライアントコンポーネント。
 * 0 になったら「期限切れ」と表示するのみで、画面遷移など既存の期限切れ処理は呼び出し側に委ねる。
 * 複数個同時に表示しても、それぞれが独立した interval を持ち、unmount 時に自動でクリーンアップされる。
 */
export function RemainingCountdown({
  expiresAt,
  className,
}: {
  expiresAt: string;
  className?: string;
}) {
  // 現在時刻は state として保持し、1 秒ごとに setInterval のコールバック（レンダー外）から
  // 更新する。レンダー本体では Date.now() 等の非純粋な関数を直接呼ばない。
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className={className}>{remainingLabel(expiresAt, now)}</span>;
}
