"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  createEvent,
  resolveEventByName,
  type ResolveEventResult,
} from "@/app/actions";
import {
  Button,
  ErrorText,
  FieldLabel,
  formatRemaining,
  Hint,
  PageTitle,
  Screen,
  TextField,
  TextLink,
} from "@/components/ui";
import { useProfile } from "@/lib/local/use-profile";

// SC-002 イベント入室 / ホーム ＋ SC-003 イベント作成確認（同一ページ内でモード切替）。
export default function HomePage() {
  const router = useRouter();
  const { ready, profile } = useProfile();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // SC-003（作成確認）のデータ。null のうちは SC-002（入力）を表示。
  const [confirm, setConfirm] = useState<
    Extract<ResolveEventResult, { status: "not_found" }> | null
  >(null);

  useEffect(() => {
    if (ready && !profile) {
      router.replace("/onboarding?next=/");
    }
  }, [ready, profile, router]);

  async function handleResolve() {
    setError(null);
    setPending(true);
    try {
      const result = await resolveEventByName(name);
      if (result.status === "invalid") {
        setError(result.message);
      } else if (result.status === "found") {
        router.push(`/e/${result.slug}`);
        return;
      } else {
        setConfirm(result);
      }
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください");
    } finally {
      setPending(false);
    }
  }

  async function handleCreate() {
    if (!confirm) return;
    setError(null);
    setPending(true);
    try {
      const result = await createEvent(name);
      if (result.status === "invalid") {
        setError(result.message);
      } else {
        router.push(`/e/${result.slug}`);
        return;
      }
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください");
    } finally {
      setPending(false);
    }
  }

  if (!ready || !profile) {
    return (
      <Screen>
        <Hint>読み込み中…</Hint>
      </Screen>
    );
  }

  // ── SC-003 イベント作成確認 ──
  if (confirm) {
    return (
      <Screen>
        <PageTitle>このイベントはまだありません</PageTitle>

        <div className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            似ているイベント
          </h2>
          {confirm.similar.length === 0 ? (
            <Hint>似たイベントは見つかりませんでした</Hint>
          ) : (
            <ul className="flex flex-col gap-2">
              {confirm.similar.map((s) => (
                <li key={s.slug}>
                  <button
                    type="button"
                    onClick={() => router.push(`/e/${s.slug}`)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-3 text-left hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                      #{s.displayName}
                    </span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {s.memberCount}人参加 / {formatRemaining(s.expiresAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">新しく作る</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            作成名: <span className="font-medium">#{confirm.normalizedPreview}</span>
          </p>
          <div className="mt-3">
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? "作成中…" : "このまま作る"}
            </Button>
          </div>
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              setConfirm(null);
              setError(null);
            }}
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            やめる
          </button>
        </div>
      </Screen>
    );
  }

  // ── SC-002 イベント入室 / ホーム ──
  return (
    <Screen>
      <div className="flex items-center justify-between">
        <PageTitle>Bocchi</PageTitle>
        <TextLink href="/profile">プロフィール</TextLink>
      </div>
      <Hint>同じ懇親会の“今ひとり”な人とつながる</Hint>

      <div className="mt-8">
        <FieldLabel>イベントに入る</FieldLabel>
        <div className="flex gap-2">
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="#イベント名を入力"
            maxLength={50}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pending) handleResolve();
            }}
          />
          <button
            type="button"
            onClick={handleResolve}
            disabled={pending}
            aria-label="入室"
            className="shrink-0 rounded-lg bg-indigo-600 px-4 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending ? "…" : "→"}
          </button>
        </div>
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </div>

      <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
        URL や QR で入るのがいちばん簡単です。
      </p>
    </Screen>
  );
}
