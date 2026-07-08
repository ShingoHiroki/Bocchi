"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { useHydrated } from "@/lib/local/use-hydrated";

// イベント共有用の URL コピー＋QR コード表示（SC-004）。
export function ShareBar({ path }: { path: string }) {
  const hydrated = useHydrated();
  // origin はブラウザでしか分からないため、ハイドレーション後にのみ絶対 URL を組み立てる。
  const url = hydrated ? `${window.location.origin}${path}` : "";
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!showQr || !url) return;
    QRCode.toDataURL(url, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [showQr, url]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        このイベントを共有する
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {copied ? "コピーしました" : "URL をコピー"}
        </button>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {showQr ? "QR を隠す" : "QR を表示"}
        </button>
      </div>
      {showQr && (
        <div className="mt-3 flex justify-center">
          {qrDataUrl ? (
            // 自己完結の data URL 画像なので next/image ではなく img で十分。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="イベント共有用 QR コード" width={220} height={220} />
          ) : (
            <p className="text-sm text-zinc-500">QR を生成中…</p>
          )}
        </div>
      )}
      {url && <p className="mt-2 text-xs break-all text-zinc-400">{url}</p>}
    </div>
  );
}
