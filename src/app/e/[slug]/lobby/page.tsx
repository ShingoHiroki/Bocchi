"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { enterLobby, leaveLobby, lobbyTick, type LobbyTickResult } from "@/app/actions";
import { ExpiredNotice } from "@/components/expired-notice";
import { MatchOverlay } from "@/components/match-overlay";
import { Button, Hint, PageTitle, Screen } from "@/components/ui";
import type { LocalProfile } from "@/lib/local/profile";
import { useProfile } from "@/lib/local/use-profile";
import { LOBBY_TICK_INTERVAL_MS, MATCH_WAIT_TARGET_MAX_MS } from "@/lib/matching-config";

type Phase =
  | { kind: "loading" }
  | { kind: "fatal"; reason: "expired" | "not_found" }
  | { kind: "waiting"; waitingCount: number }
  | { kind: "matched"; roomId: string; roomName: string; memberCount: number; capacity: number };

// SC-006 ロビー待機。クライアント主導の tick（R4）でマッチングを進め、
// 待機人数・自分の状態をポーリング取得（R1）する。マッチ成立で OV-01 を表示する。
export default function LobbyPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { ready, profile } = useProfile();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [connLost, setConnLost] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const startRef = useRef<number>(0);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const stopTimers = useCallback(() => {
    if (tickTimer.current) clearInterval(tickTimer.current);
    if (clockTimer.current) clearInterval(clockTimer.current);
    tickTimer.current = null;
    clockTimer.current = null;
  }, []);

  const applyTick = useCallback(
    (res: LobbyTickResult) => {
      setConnLost(false);
      switch (res.status) {
        case "not_found":
          stoppedRef.current = true;
          stopTimers();
          setPhase({ kind: "fatal", reason: "not_found" });
          break;
        case "expired":
          stoppedRef.current = true;
          stopTimers();
          setPhase({ kind: "fatal", reason: "expired" });
          break;
        case "matched":
          stoppedRef.current = true;
          stopTimers();
          setPhase({
            kind: "matched",
            roomId: res.roomId,
            roomName: res.roomName,
            memberCount: res.memberCount,
            capacity: res.capacity,
          });
          break;
        case "waiting":
          setPhase({ kind: "waiting", waitingCount: res.waitingCount });
          break;
        case "not_waiting":
          // 待機登録が消えている（別タブで解除等）。待機中 1 人として扱い次サイクルで再確認。
          setPhase((prev) => (prev.kind === "matched" ? prev : { kind: "waiting", waitingCount: 1 }));
          break;
      }
    },
    [stopTimers],
  );

  const runTick = useCallback(
    async (p: LocalProfile) => {
      try {
        const res = await lobbyTick({ slug, deviceId: p.deviceId });
        if (stoppedRef.current) return;
        applyTick(res);
      } catch {
        // 通信断・Realtime 切断相当。表示は待機継続のまま、次サイクルで再試行（SC-006 エラー状態）。
        if (!stoppedRef.current) setConnLost(true);
      }
    },
    [slug, applyTick],
  );

  useEffect(() => {
    if (!ready) return;
    if (!profile) {
      router.replace(`/onboarding?next=/e/${slug}/lobby`);
      return;
    }

    stoppedRef.current = false;
    let cancelled = false;

    (async () => {
      try {
        const res = await enterLobby({
          slug,
          nickname: profile.nickname,
          xAccount: profile.xAccount,
          deviceId: profile.deviceId,
        });
        if (cancelled) return;
        if (res.status === "not_found") {
          setPhase({ kind: "fatal", reason: "not_found" });
          return;
        }
        if (res.status === "expired") {
          setPhase({ kind: "fatal", reason: "expired" });
          return;
        }
        startRef.current = Date.now();
        setPhase({ kind: "waiting", waitingCount: 1 });

        // 経過時間の表示用クロック（1 秒ごと）。
        clockTimer.current = setInterval(() => {
          setElapsedMs(Date.now() - startRef.current);
        }, 1000);

        // マッチング＋状態取得の tick。まず 1 回即実行し、以降は一定間隔で回す。
        void runTick(profile);
        tickTimer.current = setInterval(() => void runTick(profile), LOBBY_TICK_INTERVAL_MS);
      } catch {
        if (!cancelled) setConnLost(true);
      }
    })();

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      stopTimers();
    };
  }, [ready, profile, slug, router, runTick, stopTimers]);

  const handleLeave = useCallback(async () => {
    stoppedRef.current = true;
    stopTimers();
    if (profile) {
      try {
        await leaveLobby({ slug, deviceId: profile.deviceId });
      } catch {
        // 解除に失敗しても画面遷移は進める（待機は次の期限切れ/tick で自然消滅）。
      }
    }
    router.push(`/e/${slug}`);
  }, [profile, slug, router, stopTimers]);

  const handleJoin = useCallback(() => {
    if (phase.kind !== "matched") return;
    router.push(`/e/${slug}/rooms/${phase.roomId}`);
  }, [phase, slug, router]);

  if (!ready || !profile || phase.kind === "loading") {
    return (
      <Screen>
        <Hint>読み込み中…</Hint>
      </Screen>
    );
  }

  if (phase.kind === "fatal") return <ExpiredNotice reason={phase.reason} />;

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const targetSec = Math.round(MATCH_WAIT_TARGET_MAX_MS / 1000);
  const alone = phase.kind === "waiting" && phase.waitingCount <= 1;

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <PageTitle>ロビー</PageTitle>
        <button
          type="button"
          onClick={handleLeave}
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          待機をやめる
        </button>
      </div>

      {phase.kind === "waiting" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-950">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
          </span>
          <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
            ロビーで待機中…
          </p>
        </div>
      )}

      {connLost && (
        <div className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          接続が切れました。再接続中…
        </div>
      )}

      <div className="mt-8 flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin dark:border-indigo-900 dark:border-t-indigo-400" />
        <p className="text-base font-medium text-zinc-800 dark:text-zinc-100">
          相手を探しています…
        </p>
        <p className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">
          ロビーに {phase.kind === "waiting" ? phase.waitingCount : 1} 人 待機中
        </p>
        <Hint>
          経過 {elapsedSec} 秒（目安 {targetSec} 秒ほどでマッチします）
        </Hint>
        <Hint>マッチが成立すると自動でルームに案内されます。このまま待っていて大丈夫です。</Hint>

        {alone ? (
          <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-left dark:border-indigo-900 dark:bg-indigo-950">
            <p className="text-sm text-indigo-900 dark:text-indigo-200">
              まだ相手が見つかりません。空くのを待つか、自分でルームを作って受け皿になると
              合流されやすくなります。
            </p>
            <button
              type="button"
              onClick={() => router.push(`/e/${slug}/rooms/new`)}
              className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              自分でルームを作る
            </button>
          </div>
        ) : (
          <Hint>
            空いているルームが見つかると自動で合流します。見つからなければ、待っている人同士でルームを作ります。
          </Hint>
        )}
      </div>

      <div className="mt-6">
        <Button variant="secondary" onClick={handleLeave}>
          自分でルームを選ぶ
        </Button>
      </div>

      {phase.kind === "matched" && (
        <MatchOverlay
          roomName={phase.roomName}
          memberCount={phase.memberCount}
          capacity={phase.capacity}
          onJoin={handleJoin}
        />
      )}
    </Screen>
  );
}
