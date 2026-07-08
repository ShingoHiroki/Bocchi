"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { isStorageUsable, saveProfile } from "@/lib/local/profile";
import { useProfile } from "@/lib/local/use-profile";
import { validateNickname, validateXAccount } from "@/lib/domain/services/validation";

// SC-008 プロフィール編集。
function ProfileForm({
  initialNickname,
  initialXAccount,
}: {
  initialNickname: string;
  initialXAccount: string;
}) {
  const [nickname, setNickname] = useState(initialNickname);
  const [xAccount, setXAccount] = useState(initialXAccount);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);

  function handleSave() {
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
    setStorageWarning(!isStorageUsable());
    setSaved(true);
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      <div>
        <FieldLabel>ニックネーム（必須）</FieldLabel>
        <TextField
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            setSaved(false);
          }}
          maxLength={20}
        />
      </div>
      <div>
        <FieldLabel>X アカウント（任意）</FieldLabel>
        <TextField
          value={xAccount}
          onChange={(e) => {
            setXAccount(e.target.value);
            setSaved(false);
          }}
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
      {saved && <p className="text-sm text-green-600 dark:text-green-400">保存しました。</p>}

      <Hint>変更は今後の入室に反映されます（進行中のルーム表示は変わりません）。</Hint>

      <Button onClick={handleSave}>保存</Button>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { ready, profile } = useProfile();

  useEffect(() => {
    if (ready && !profile) {
      router.replace("/onboarding?next=/profile");
    }
  }, [ready, profile, router]);

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <PageTitle>プロフィール</PageTitle>
        <TextLink href="/">戻る</TextLink>
      </div>

      {!ready || !profile ? (
        <Hint>読み込み中…</Hint>
      ) : (
        <ProfileForm initialNickname={profile.nickname} initialXAccount={profile.xAccount} />
      )}
    </Screen>
  );
}
