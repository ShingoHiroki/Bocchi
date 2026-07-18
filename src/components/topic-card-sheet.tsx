"use client";

/**
 * OV-04 話題カード表示（SC-007 の中核・D7）。
 *
 * チャット下部の「話題カードを引く」から開くボトムシート。ランダムなお題を表示し、
 * 「別のお題を引く」で引き直し、「みんなに送る」でチャットへ共有する（screen-flow-design.md SC-007）。
 * お題の取得（drawTopicCard）はアダプター層越し、送信（onSend）は呼び出し側の Server Action に委ねる。
 */

import { useCallback, useEffect, useState } from "react";

import { drawTopicCard, type TopicCard } from "@/app/actions";
import { Button, Hint } from "@/components/ui";

const CATEGORY_LABEL: Record<TopicCard["category"], string> = {
  tech: "技術の話",
  general: "ちょっと雑談",
};

export function TopicCardSheet({
  open,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  /** お題をチャットへ共有する（成功したらシートを閉じる）。 */
  onSend: (promptText: string) => Promise<void>;
}) {
  const [card, setCard] = useState<TopicCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(async (excludeId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await drawTopicCard(excludeId);
      if (next) setCard(next);
      else setError("お題を取得できませんでした。もう一度お試しください。");
    } catch {
      setError("お題を取得できませんでした。もう一度お試しください。");
    } finally {
      setLoading(false);
    }
  }, []);

  // 開いたときにお題が無ければ 1 枚引く。card が無い間はカード領域が「選んでいます…」を出すため、
  // ここでは loading を触らず、取得完了（await 後）に初めて state を更新する
  // （エフェクト内で同期的に setState しない）。引き直しは draw() を使う。
  useEffect(() => {
    if (!open || card) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await drawTopicCard();
        if (cancelled) return;
        if (next) setCard(next);
        else setError("お題を取得できませんでした。もう一度お試しください。");
      } catch {
        if (!cancelled) setError("お題を取得できませんでした。もう一度お試しください。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, card]);

  const close = useCallback(() => {
    // 次に開いたときは新しいお題を引くよう、閉じる際に手札をクリアする。
    setCard(null);
    setError(null);
    onClose();
  }, [onClose]);

  if (!open) return null;

  const handleSend = async () => {
    if (!card) return;
    setSending(true);
    try {
      await onSend(card.promptText);
      close();
    } catch {
      setError("送信できませんでした。もう一度お試しください。");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="話題カード"
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            🃏 話題カード
          </h2>
          <button
            type="button"
            onClick={close}
            className="-mr-1 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            閉じる
          </button>
        </div>

        {/* お題カード */}
        <div className="mt-4 flex min-h-[7rem] flex-col justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-5 text-center dark:border-indigo-900 dark:bg-indigo-950">
          {loading || !card ? (
            <p className="text-sm text-indigo-400 dark:text-indigo-500">お題を選んでいます…</p>
          ) : (
            <>
              <span className="mb-2 inline-block self-center rounded-full bg-indigo-600/10 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">
                {CATEGORY_LABEL[card.category]}
              </span>
              <p className="text-lg font-semibold leading-relaxed text-indigo-900 dark:text-indigo-100">
                {card.promptText}
              </p>
            </>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <Hint>
          <span className="mt-3 block">
            気になるお題が出たら「みんなに送る」でチャットに共有できます。
          </span>
        </Hint>

        {/* アクション */}
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            onClick={() => card && draw(card.id)}
            disabled={loading || sending || !card}
          >
            別のお題を引く
          </Button>
          <Button onClick={handleSend} disabled={loading || sending || !card}>
            {sending ? "送信中…" : "みんなに送る"}
          </Button>
        </div>
      </div>
    </div>
  );
}
