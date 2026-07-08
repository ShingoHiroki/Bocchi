"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { getRoomDetail, type RoomDetailResult } from "@/app/actions";
import { ExpiredNotice } from "@/components/expired-notice";
import { formatRemaining, Hint, PageTitle, Screen, TextLink } from "@/components/ui";

// SC-007 ルームチャットのプレースホルダ（本実装は M3）。
// M1 ではルーム名・参加人数・メンバー一覧の表示のみ。
export default function RoomDetailPage() {
  const params = useParams<{ slug: string; roomId: string }>();
  const { slug, roomId } = params;
  const [result, setResult] = useState<RoomDetailResult | null>(null);

  useEffect(() => {
    getRoomDetail(roomId).then(setResult);
  }, [roomId]);

  if (result === null) {
    return (
      <Screen>
        <Hint>読み込み中…</Hint>
      </Screen>
    );
  }
  if (result.status === "not_found") return <ExpiredNotice reason="not_found" />;
  if (result.status === "expired") return <ExpiredNotice reason="expired" />;

  const { room, members } = result;

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <PageTitle>{room.name}</PageTitle>
          <Hint>
            {room.memberCount}/{room.capacity} 人 ・ {formatRemaining(room.expiresAt)}
          </Hint>
        </div>
        <TextLink href={`/e/${slug}`}>ルーム一覧へ</TextLink>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">メンバー</h2>
        <ul className="flex flex-col gap-2">
          {members.map((m, i) => (
            <li
              key={i}
              className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{m.nickname}</span>
              {m.xAccount && (
                <a
                  href={`https://x.com/${m.xAccount}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  @{m.xAccount}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 rounded-lg border border-dashed border-zinc-300 p-4 text-center dark:border-zinc-700">
        <Hint>チャット機能は準備中です（M3 で実装予定）。</Hint>
      </div>
    </Screen>
  );
}
