"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getRoomChat,
  joinRoom,
  leaveRoom,
  pollRoomMessages,
  postRoomMessage,
  type ChatMessage,
  type RoomChatResult,
} from "@/app/actions";
import { ExpiredNotice } from "@/components/expired-notice";
import { RemainingCountdown } from "@/components/remaining-countdown";
import { Button, ErrorText, Hint, Screen } from "@/components/ui";
import { QUICK_REPLIES } from "@/lib/domain/services/chat-content";
import { validateMessageBody } from "@/lib/domain/services/validation";
import type { LocalProfile } from "@/lib/local/profile";
import { useProfile } from "@/lib/local/use-profile";
import { ROOM_MESSAGES_POLL_INTERVAL_MS } from "@/lib/matching-config";

type RoomInfo = { name: string; capacity: number; memberCount: number; expiresAt: string };
type Member = { nickname: string; xAccount: string | null };

/** 送信中／失敗中の楽観メッセージ（自分の発言・即時反映用）。 */
type PendingMessage = { localId: string; body: string; failed: boolean };

// SC-007 ルームチャット。マッチ成立・入室後の本体。
// システム初期メッセージ（D4）＋クイック返信＋自由入力で集合場所を相談し、物理合流する。
// 複数端末同期は Server Action のポーリング（R1）で行う。
export default function RoomDetailPage() {
  const router = useRouter();
  const params = useParams<{ slug: string; roomId: string }>();
  const { slug, roomId } = params;
  const { ready, profile } = useProfile();

  const [fatal, setFatal] = useState<"not_found" | "expired" | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [joining, setJoining] = useState(false);
  const [connLost, setConnLost] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [loading, setLoading] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    // ポーリング結果でサーバー確定分を置き換える（id で一意）。作成順は Server Action 側で担保。
    setMessages(incoming);
  }, []);

  const applyChat = useCallback((res: RoomChatResult) => {
    if (res.status === "not_found") {
      setFatal("not_found");
      return;
    }
    if (res.status === "expired") {
      setFatal("expired");
      return;
    }
    setRoom(res.room);
    setMembers(res.members);
    setIsMember(res.isMember);
    setMessages(res.messages);
  }, []);

  // 初回ロード。
  useEffect(() => {
    if (!ready) return;
    if (!profile) {
      router.replace(`/onboarding?next=/e/${slug}/rooms/${roomId}`);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getRoomChat(roomId, profile.deviceId);
        if (cancelled) return;
        applyChat(res);
      } catch {
        if (!cancelled) setConnLost(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, profile, slug, roomId, router, applyChat]);

  // ポーリング（複数端末同期）。fatal になったら止める。
  useEffect(() => {
    if (!profile || fatal) return;
    stoppedRef.current = false;
    const deviceId = profile.deviceId;

    const tick = async () => {
      try {
        const res = await pollRoomMessages(roomId, deviceId);
        if (stoppedRef.current) return;
        setConnLost(false);
        if (res.status === "not_found") {
          setFatal("not_found");
          return;
        }
        if (res.status === "expired") {
          setFatal("expired");
          return;
        }
        setRoom((prev) => (prev ? { ...prev, memberCount: res.memberCount } : prev));
        mergeMessages(res.messages);
      } catch {
        if (!stoppedRef.current) setConnLost(true);
      }
    };

    pollTimer.current = setInterval(() => void tick(), ROOM_MESSAGES_POLL_INTERVAL_MS);
    return () => {
      stoppedRef.current = true;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [profile, roomId, fatal, mergeMessages]);

  // 新着で最下部へスクロール。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  const send = useCallback(
    async (raw: string, p: LocalProfile) => {
      const body = raw;
      const err = validateMessageBody(body);
      if (err) {
        setInputError(err);
        return;
      }
      setInputError(null);
      const localId = globalThis.crypto.randomUUID();
      setPending((prev) => [...prev, { localId, body: body.trim(), failed: false }]);
      setSending(true);
      try {
        const res = await postRoomMessage({
          roomId,
          nickname: p.nickname,
          deviceId: p.deviceId,
          body,
        });
        if (res.status === "ok") {
          // 確定分へ即時反映し、次のポーリングまでの空白をなくす（id で重複しない）。
          setMessages((prev) =>
            prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
          );
          setPending((prev) => prev.filter((x) => x.localId !== localId));
        } else if (res.status === "invalid") {
          setInputError(res.message);
          setPending((prev) => prev.filter((x) => x.localId !== localId));
        } else {
          setFatal(res.status);
          setPending((prev) => prev.filter((x) => x.localId !== localId));
        }
      } catch {
        // 送信直後の通信失敗（E12）: 楽観表示は残し「再送」できるようにする。
        setPending((prev) =>
          prev.map((x) => (x.localId === localId ? { ...x, failed: true } : x)),
        );
      } finally {
        setSending(false);
      }
    },
    [roomId],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!profile || sending) return;
      const body = draft;
      setDraft("");
      void send(body, profile);
    },
    [draft, profile, sending, send],
  );

  const handleQuickReply = useCallback(
    (text: string) => {
      if (!profile || sending) return;
      void send(text, profile);
    },
    [profile, sending, send],
  );

  const handleResend = useCallback(
    (localId: string) => {
      if (!profile) return;
      const target = pending.find((x) => x.localId === localId);
      if (!target) return;
      setPending((prev) => prev.filter((x) => x.localId !== localId));
      void send(target.body, profile);
    },
    [pending, profile, send],
  );

  const handleJoin = useCallback(async () => {
    if (!profile) return;
    setJoining(true);
    try {
      const res = await joinRoom({
        roomId,
        nickname: profile.nickname,
        xAccount: profile.xAccount,
        deviceId: profile.deviceId,
      });
      if (res.status === "joined" || res.status === "already_member") {
        const chat = await getRoomChat(roomId, profile.deviceId);
        applyChat(chat);
      } else if (res.status === "not_found") {
        setFatal("not_found");
      }
      // full の場合は下の満員表示のまま（isMember=false で参加不可）。
    } catch {
      setConnLost(true);
    } finally {
      setJoining(false);
    }
  }, [profile, roomId, applyChat]);

  const handleLeave = useCallback(async () => {
    stoppedRef.current = true;
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (profile) {
      try {
        await leaveRoom({ roomId, deviceId: profile.deviceId });
      } catch {
        // 退室 API が失敗しても画面遷移は進める（一覧側で再同期される）。
      }
    }
    router.push(`/e/${slug}`);
  }, [profile, roomId, slug, router]);

  if (!ready || (loading && !room)) {
    return (
      <Screen>
        <Hint>読み込み中…</Hint>
      </Screen>
    );
  }
  if (fatal) return <ExpiredNotice reason={fatal} />;
  if (!room) {
    return (
      <Screen>
        <Hint>読み込み中…</Hint>
      </Screen>
    );
  }

  const full = room.memberCount >= room.capacity;
  const alone = room.memberCount <= 1;
  const canPost = isMember;

  return (
    <Screen>
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {room.name}
          </h1>
          <Hint>
            {room.memberCount}/{room.capacity} 人 ・{" "}
            <RemainingCountdown expiresAt={room.expiresAt} />
          </Hint>
        </div>
        <button
          type="button"
          onClick={() => setConfirmLeave(true)}
          className="shrink-0 text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          退室
        </button>
      </div>

      {/* メンバー */}
      <div className="mt-3 flex flex-wrap gap-2">
        {members.map((m, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {m.nickname}
            {m.xAccount && (
              <a
                href={`https://x.com/${m.xAccount}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                @{m.xAccount}
              </a>
            )}
          </span>
        ))}
      </div>

      {connLost && (
        <div className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          接続が切れました。再接続中…
        </div>
      )}

      {/* メッセージリスト */}
      <div className="mt-3 flex flex-1 flex-col gap-3 overflow-y-auto py-2">
        {alone && (
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-center text-sm text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
            まだあなただけです。合流する人を待ちましょう。話題カードで準備しておくのもおすすめです。
          </p>
        )}

        {messages.map((m) =>
          m.senderType === "system" ? (
            <div key={m.id} className="flex justify-center">
              <div className="max-w-[90%] rounded-lg bg-zinc-100 px-3 py-2 text-center text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {m.body}
              </div>
            </div>
          ) : (
            <MessageBubble key={m.id} nickname={m.senderNickname} body={m.body} mine={m.mine} />
          ),
        )}

        {/* 楽観表示（送信中／失敗）。自分の発言として右寄せ。 */}
        {pending.map((p) => (
          <div key={p.localId} className="flex flex-col items-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-indigo-600/70 px-3 py-2 text-sm text-white">
              {p.body}
            </div>
            {p.failed ? (
              <button
                type="button"
                onClick={() => handleResend(p.localId)}
                className="mt-0.5 text-xs text-red-600 hover:underline dark:text-red-400"
              >
                送信できませんでした・再送する
              </button>
            ) : (
              <span className="mt-0.5 text-xs text-zinc-400">送信中…</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 直近アクション帯: クイック返信＋話題カード（M4 は準備中） */}
      {canPost && (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              disabled={sending}
              onClick={() => handleQuickReply(q)}
              className="rounded-full border border-indigo-300 px-3 py-1.5 text-sm text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
            >
              {q}
            </button>
          ))}
          <button
            type="button"
            disabled
            className="rounded-full border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-400 dark:border-zinc-700"
          >
            話題カードを引く（準備中）
          </button>
        </div>
      )}

      {/* フッター: 入力欄＋送信 or 参加/満員導線 */}
      {canPost ? (
        <form onSubmit={handleSubmit} className="mt-2">
          <ErrorText>{inputError}</ErrorText>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={1}
              maxLength={500}
              placeholder="メッセージを入力"
              className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-base font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              送信
            </button>
          </div>
        </form>
      ) : full ? (
        <div className="mt-3 rounded-lg border border-zinc-200 p-3 text-center dark:border-zinc-800">
          <Hint>
            このルームは満員です。ほかのルームを探すか、待ってみましょう。
          </Hint>
          <div className="mt-2">
            <Button variant="secondary" onClick={() => router.push(`/e/${slug}`)}>
              ほかのルームを見る
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button onClick={handleJoin} disabled={joining}>
            {joining ? "参加中…" : "このルームに参加する"}
          </Button>
        </div>
      )}

      {/* OV-02 退室確認 */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              このルームから退室しますか？
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              退室すると会話から抜けます。ルーム一覧に戻ります。
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
                キャンセル
              </Button>
              <Button onClick={handleLeave}>退室する</Button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}

function MessageBubble({
  nickname,
  body,
  mine,
}: {
  nickname: string;
  body: string;
  mine: boolean;
}) {
  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white">
          {body}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start">
      <span className="mb-0.5 text-xs text-zinc-500 dark:text-zinc-400">{nickname}</span>
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
        {body}
      </div>
    </div>
  );
}
