"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { getRoomList, joinRoom, type RoomListResult } from "@/app/actions";
import { ExpiredNotice } from "@/components/expired-notice";
import { ShareBar } from "@/components/share-bar";
import { Button, formatRemaining, Hint, PageTitle, Screen, TextLink } from "@/components/ui";
import type { LocalProfile } from "@/lib/local/profile";
import { useProfile } from "@/lib/local/use-profile";

// SC-004 ルーム一覧（イベントホーム）。
export default function RoomListPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { ready, profile } = useProfile();

  const [result, setResult] = useState<RoomListResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const reload = useCallback(
    async (p: LocalProfile) => {
      const res = await getRoomList(slug, p.deviceId);
      setResult(res);
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
    getRoomList(slug, profile.deviceId).then((res) => {
      if (active) setResult(res);
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
          <Hint>{formatRemaining(event.expiresAt)}</Hint>
        </div>
        <TextLink href="/">イベントを出る</TextLink>
      </div>

      {/* ロビー待機バナー（SC-006 は M2 のため導線のみ・準備中） */}
      <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950">
        <p className="text-sm text-indigo-900 dark:text-indigo-200">
          自分で選ばず、おまかせで合流したい人はこちら
        </p>
        <button
          type="button"
          onClick={() => router.push(`/e/${slug}/lobby`)}
          className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          おまかせで待つ（準備中）
        </button>
      </div>

      <div className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">ルーム</h2>
        {rooms.length === 0 ? (
          <Hint>
            まだルームがありません。最初のルームを作るか、おまかせで待ちましょう。
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
                  <span className="text-xs text-zinc-400">{formatRemaining(room.expiresAt)}</span>
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
