"use client";

import { useRouter } from "next/navigation";

import { Button, Hint, PageTitle, Screen } from "@/components/ui";

// SC-009 期限切れ / エラー。原因区分ごとに文言を出し、新しい行動へ戻す導線を用意する。
export type NoticeReason = "expired" | "not_found" | "invalid";

const MESSAGES: Record<NoticeReason, { title: string; body: string }> = {
  expired: {
    title: "このイベントは終了しました",
    body: "イベントは作成から 24 時間で自動的に閉じます。",
  },
  not_found: {
    title: "このイベントは見つかりませんでした",
    body: "URL が正しいか確認するか、別のイベントを探してみましょう。",
  },
  invalid: {
    title: "リンクが正しくないようです",
    body: "お手数ですが、共有元のリンクをもう一度ご確認ください。",
  },
};

export function ExpiredNotice({ reason }: { reason: NoticeReason }) {
  const router = useRouter();
  const { title, body } = MESSAGES[reason];

  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <PageTitle>{title}</PageTitle>
        <Hint>{body}</Hint>
        <div className="mt-4 w-full max-w-xs">
          <Button onClick={() => router.push("/")}>別のイベントを探す</Button>
        </div>
      </div>
    </Screen>
  );
}
