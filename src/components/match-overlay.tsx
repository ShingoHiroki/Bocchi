"use client";

/**
 * OV-01 マッチ成立オーバーレイ（SC-006 の中核演出・D7）。
 *
 * Web Push を持たない制約に対し、成立時に全画面オーバーレイ＋効果音＋バイブで強く通知する。
 * 「視覚を主・音／バイブを従」とし、音やバイブが端末制約で鳴らなくても
 * 視覚だけで確実に気づけるようにする。一定時間反応しなくても割当は保持され、
 * このオーバーレイは残り続けるので、後からタップして参加できる。
 */

import { useEffect } from "react";

import { Button } from "@/components/ui";

type MatchOverlayProps = {
  roomName: string;
  memberCount: number;
  capacity: number;
  onJoin: () => void;
};

/** 短いビープ音を鳴らす（外部アセット不要の Web Audio）。失敗しても無視する（視覚が主）。 */
function playChime(): void {
  try {
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    // 2 音の軽やかな上昇（ソ→ド）。
    [
      [784, now, 0.18],
      [1046, now + 0.16, 0.28],
    ].forEach(([freq, start, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
    // 再生後にコンテキストを閉じる（多重生成の抑制）。
    window.setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    // 自動再生制限などで失敗しても無視（視覚が主）。
  }
}

/** バイブレーション（対応端末のみ）。 */
function vibrate(): void {
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // 非対応端末では何もしない。
  }
}

export function MatchOverlay({ roomName, memberCount, capacity, onJoin }: MatchOverlayProps) {
  // 表示された瞬間に一度だけ音・バイブを発火する。
  useEffect(() => {
    playChime();
    vibrate();
  }, []);

  // タブが非アクティブ（別タブ・最小化）でもマッチ成立に気づけるよう、タイトルを点滅させる。
  // Web Push は使わない制約（D7）の中での軽い補強。表示中のタブでは点滅させない。
  useEffect(() => {
    const originalTitle = document.title;
    const flashTitle = "🎉 マッチ成立！";
    let timer: ReturnType<typeof setInterval> | null = null;
    let showFlash = false;

    const startFlashing = () => {
      if (timer) return;
      timer = setInterval(() => {
        document.title = showFlash ? flashTitle : originalTitle;
        showFlash = !showFlash;
      }, 800);
    };
    const stopFlashing = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      document.title = originalTitle;
    };

    const handleVisibility = () => {
      if (document.hidden) startFlashing();
      else stopFlashing();
    };

    // 成立時点で既にバックグラウンドなら即点滅を始める。
    if (document.hidden) startFlashing();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopFlashing();
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="マッチ成立"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-indigo-600 px-6 text-center text-white"
    >
      <div className="animate-pulse text-sm font-semibold tracking-widest">MATCH!</div>
      <div className="flex flex-col items-center gap-2">
        <p className="text-lg font-medium">ルームが決まりました！</p>
        <p className="text-2xl font-bold">{roomName}</p>
        <p className="text-sm text-indigo-100">
          {memberCount}/{capacity} 人
        </p>
      </div>
      <div className="w-full max-w-xs">
        <Button
          variant="secondary"
          onClick={onJoin}
          className="border-white bg-white text-indigo-700 hover:bg-indigo-50"
        >
          参加する
        </Button>
      </div>
      <p className="text-xs text-indigo-200">タップするまで席は確保されています</p>
    </div>
  );
}
