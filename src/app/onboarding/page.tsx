"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import {
  Button,
  ErrorText,
  FieldLabel,
  Hint,
  PageTitle,
  Screen,
  TextField,
} from "@/components/ui";
import { isStorageUsable, saveProfile } from "@/lib/local/profile";
import { validateNickname, validateXAccount } from "@/lib/domain/services/validation";

// SC-001 オンボーディング（ニックネーム入力）。
function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [nickname, setNickname] = useState("");
  const [xAccount, setXAccount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);

  function handleStart() {
    const nickError = validateNickname(nickname);
    if (nickError) {
      setError(nickError);
      return;
    }
    const xError = validateXAccount(xAccount);
    if (xError) {
      setError(xError);
      return;
    }
    setError(null);

    saveProfile({ nickname, xAccount });
    if (!isStorageUsable()) {
      // セッション内メモリで暫定続行しつつ警告を出す（SC-001 エラー状態）。
      setStorageWarning(true);
    }
    router.replace(next);
  }

  return (
    <Screen>
      <PageTitle>Bocchi</PageTitle>
      <Hint>同じ懇親会の“今ひとり”な人とつながる</Hint>

      <div className="mt-8 flex flex-col gap-4">
        <div>
          <FieldLabel>ニックネーム（必須）</FieldLabel>
          <TextField
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="たろう"
            maxLength={20}
          />
        </div>
        <div>
          <FieldLabel>X アカウント（任意）</FieldLabel>
          <TextField
            value={xAccount}
            onChange={(e) => setXAccount(e.target.value)}
            placeholder="taro_dev（@ は不要）"
            maxLength={17}
          />
        </div>

        <ErrorText>{error}</ErrorText>
        {storageWarning && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            お使いのブラウザでは設定を保存できません。プライベートモードを解除してお試しください。
          </p>
        )}

        <Hint>この情報は端末にだけ保存されます（サーバーには送られません）。</Hint>

        <Button onClick={handleStart}>はじめる</Button>
      </div>
    </Screen>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingInner />
    </Suspense>
  );
}
