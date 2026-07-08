"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createRoom } from "@/app/actions";
import {
  Button,
  ErrorText,
  FieldLabel,
  Hint,
  PageTitle,
  Screen,
  TextField,
  TextLink,
} from "@/components/ui";
import { useProfile } from "@/lib/local/use-profile";

// SC-005 ルーム作成。1 人でも作成・入室でき、作成後は自分が参加した状態で遷移する。
export default function RoomCreatePage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { ready, profile } = useProfile();

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && !profile) {
      router.replace(`/onboarding?next=/e/${slug}/rooms/new`);
    }
  }, [ready, profile, slug, router]);

  async function handleCreate() {
    if (!profile) return;
    setError(null);
    setPending(true);
    try {
      const res = await createRoom({
        slug,
        name,
        capacity,
        nickname: profile.nickname,
        xAccount: profile.xAccount,
        deviceId: profile.deviceId,
      });
      if (res.status === "ok") {
        router.push(`/e/${slug}/rooms/${res.roomId}`);
        return;
      }
      if (res.status === "event_expired") {
        setError("このイベントは終了しました。別のイベントを探してください。");
      } else {
        setError(res.message);
      }
    } catch {
      setError("ルームを作成できませんでした。時間をおいて再度お試しください");
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

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <PageTitle>ルームを作る</PageTitle>
        <TextLink href={`/e/${slug}`}>戻る</TextLink>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <div>
          <FieldLabel>ルーム名（任意）</FieldLabel>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="未入力なら自動で名前が付きます"
            maxLength={30}
          />
        </div>

        <div>
          <FieldLabel>定員</FieldLabel>
          <select
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} 人
              </option>
            ))}
          </select>
        </div>

        <ErrorText>{error}</ErrorText>

        <Hint>1 人でも大丈夫。作って待つと、あとから人が合流できます。</Hint>

        <Button onClick={handleCreate} disabled={pending}>
          {pending ? "作成中…" : "作る"}
        </Button>
      </div>
    </Screen>
  );
}
