"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  getLobbyStatus,
  getRoomList,
  joinRoom,
  type LobbyStatusResult,
  type RoomListResult,
} from "@/app/actions";
import { ExpiredNotice } from "@/components/expired-notice";
import { RemainingCountdown } from "@/components/remaining-countdown";
import { ShareBar } from "@/components/share-bar";
import { Button, Hint, PageTitle, Screen, TextLink } from "@/components/ui";
import type { LocalProfile } from "@/lib/local/profile";
import { useProfile } from "@/lib/local/use-profile";

// SC-004 ルーム一覧（イベントホーム）。
export default function RoomListPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { ready, profile } = useProfile();

  const [result, setResult] = useState<RoomListResult | null>(null);
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatusResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const reload = useCallback(
    async (p: LocalProfile) => {
      const [res, lobby] = await Promise.all([
        getRoomList(slug, p.deviceId),
        getLobbyStatus(slug, p.deviceId),
      ]);
      setResult(res);
      setLobbyStatus(lobby);
    },
    [slug],
  );

  useEffect(() => {
    if (!ready) return;
    if (!profile) {
      router.replace(`/onboarding?next=/e/${slug}`);
      return;
    }
    let active = true;
    Promise.all([
      getRoomList(slug, profile.deviceId),
      getLobbyStatus(slug, profile.deviceId),
    ]).then(([res, lobby]) => {
      if (active) {
        setResult(res);
        setLobbyStatus(lobby);
      }
    });
    return () => {
      active = false;
    };
  }, [ready, profile, slug, router]);

  async function handleJoin(roomId: string, full: boolean, joined: boolean) {
    if (!profile) return;
    if (joined) {
      router.push(`/e/${slug}/rooms/${roomId}`);
      return;
    }
    if (full) {
      setToast("このルームは満員です。ほかのルームを探すか、待ってみましょう");
      return;
    }
    setJoiningId(roomId);
    try {
      const res = await joinRoom({
        roomId,
        nickname: profile.nickname,
        xAccount: profile.xAccount,
        deviceId: profile.deviceId,
      });
      if (res.status === "joined" || res.status === "already_member") {
        router.push(`/e/${slug}/rooms/${res.roomId}`);
      } else if (res.status === "full") {
        setToast("このルームは満員です。ほかのルームを探すか、待ってみましょう");
        reload(profile);
      } else {
        setToast("このルームは見つかりませんでした");
        reload(profile);
      }
    } catch {
      setToast("通信エラーが発生しました。時間をおいて再度お試しください");
    } finally {
      setJoiningId(null);
    }
  }

  if (!ready || !profile || result === null) {
    return (
      <Screen>
        <Hint>読み込み中…</Hint>
      </Screen>
    );
  }

  if (result.status === "not_found") return <ExpiredNotice reason="not_found" />;
  if (result.status === "expired") return <ExpiredNotice reason="expired" />;

  const { event, rooms } = result;

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <PageTitle>#{event.displayName}</PageTitle>
          <Hint>
            <RemainingCountdown expiresAt={event.expiresAt} />
          </Hint>
        </div>
        <TextLink href="/">イベントを出る</TextLink>
      </div>

      {/* この端末のロビー状態（待機中 / マッチ済みに気づいていない場合のみ表示） */}
      {lobbyStatus?.status === "waiting" && (
        <button
          type="button"
          onClick={() => router.push(`/e/${slug}/lobby`)}
          className="mt-3 flex w-full items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-left dark:bg-indigo-950"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
          </span>
          <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
            現在ロビーで待機中…（タップでロビーへ戻る）
          </p>
        </button>
      )}
      {lobbyStatus?.status === "matched" && (
        <button
          type="button"
          onClick={() => router.push(`/e/${slug}/rooms/${lobbyStatus.roomId}`)}
          className="mt-3 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left dark:border-indigo-900 dark:bg-indigo-950"
        >
          <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
            ルームが決まっています！
          </p>
          <p className="mt-0.5 text-xs text-indigo-700 dark:text-indigo-300">
            「{lobbyStatus.roomName}」に移動する
          </p>
        </button>
      )}

      {/* ロビー待機バナー（SC-006 へ。ロビーで待つと自動マッチングされる） */}
      <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950">
        {/* ロビーの待機人数を常時表示（自分の待機・マッチ状態に関わらず表示） */}
        {lobbyStatus && (
          <div className="mb-2 flex items-center gap-2 border-b border-indigo-200/60 pb-2 dark:border-indigo-800/60">
            {lobbyStatus.waitingCount > 0 ? (
              <>
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                </span>
                <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200">
                  現在ロビーで {lobbyStatus.waitingCount} 人が待機中
                </p>
              </>
            ) : (
              <p className="text-sm text-indigo-500 dark:text-indigo-400">
                ロビーで待っている人はいません
              </p>
            )}
          </div>
        )}
        <p className="text-sm text-indigo-900 dark:text-indigo-200">
          自分で選ばず、おまかせで合流したい人はこちら
        </p>
        <button
          type="button"
          onClick={() => router.push(`/e/${slug}/lobby`)}
          className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          ロビーで待つ
        </button>
        <p className="mt-1.5 text-xs text-indigo-700 dark:text-indigo-300">
          待つだけで自動でルームに入れます
        </p>
      </div>

      <div className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">ルーム</h2>
        {rooms.length === 0 ? (
          <Hint>
            まだルームがありません。最初のルームを作るか、ロビーで待ちましょう。
          </Hint>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => handleJoin(room.id, room.full, room.joined)}
                  disabled={joiningId === room.id}
                  className={`w-full rounded-lg border px-3 py-3 text-left disabled:opacity-50 ${
                    room.full && !room.joined
                      ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                      : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {room.name}
                      {room.joined && (
                        <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                          参加中
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      {room.memberCount}/{room.capacity}
                      {room.full && !room.joined ? " 満" : ""}
                    </span>
                  </div>
                  <RemainingCountdown
                    expiresAt={room.expiresAt}
                    className="text-xs text-zinc-400"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <Button onClick={() => router.push(`/e/${slug}/rooms/new`)}>ルームを作る</Button>
      </div>

      <div className="mt-5">
        <ShareBar path={`/e/${slug}`} />
      </div>

      {toast && (
        <div className="fixed inset-x-0 bottom-4 mx-auto w-full max-w-md px-4">
          <button
            type="button"
            onClick={() => setToast(null)}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-center text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {toast}
          </button>
        </div>
      )}
    </Screen>
  );
}
