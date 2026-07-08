"use client";

import { useParams } from "next/navigation";

import { Hint, PageTitle, Screen, TextLink } from "@/components/ui";

// SC-006 ロビー待機のプレースホルダ（本実装は M2）。M1 は導線のみ・準備中表示。
export default function LobbyPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <PageTitle>おまかせで待つ</PageTitle>
        <TextLink href={`/e/${slug}`}>ルーム一覧へ</TextLink>
      </div>

      <div className="mt-8 flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Hint>ロビー自動マッチングは準備中です（M2 で実装予定）。</Hint>
        <Hint>いまは「ルーム一覧」から自分でルームを選ぶか、作成してお待ちください。</Hint>
      </div>
    </Screen>
  );
}
