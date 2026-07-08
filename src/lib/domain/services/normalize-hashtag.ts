/**
 * ハッシュタグ（イベント名）の正規化。Supabase 非依存の純粋関数（docs/implementation-plan.md R5）。
 *
 * 目的: 表記ゆれによるイベント分裂（密度仮説の自壊）を防ぐため、照合前に入力を正規化する（D2）。
 *
 * 正規化ルール（この順に適用する）:
 *  1. NFKC 正規化      … 全角英数・記号や互換文字を標準形へ（例: "＃Ｇｏ" → "#Go"、半角ｶﾅ → 全角カナ）
 *  2. 前後空白の除去    … trim
 *  3. 先頭の "#" 除去   … ユーザーが付けても付けなくても同じ結果にする（"#go" と "go" を同一視）
 *  4. 小文字化          … 英字の大文字小文字を無視して照合する（"Go" と "go" を同一視）
 *  5. 記号・空白の統一  … 英数字・かな・漢字などの「文字」以外（空白・記号・絵文字）の連続を
 *                          ハイフン 1 個へ置換し、先頭・末尾のハイフンは取り除く
 *
 * 返り値: 照合・保存に使う正規化済み文字列。すべて記号だけの入力などでは空文字列になり得る
 *         （呼び出し側は空文字列を「イベント名として不正」として扱う）。
 */
export function normalizeHashtag(input: string): string {
  // \p{L}=あらゆる言語の文字（日本語含む）, \p{N}=数字。これら以外の連続をハイフンに畳む。
  // tsconfig の target が ES2018 未満でも動くよう、正規表現は RegExp コンストラクタで生成する。
  const nonWordRun = new RegExp("[^\\p{L}\\p{N}]+", "gu");

  return input
    .normalize("NFKC")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(nonWordRun, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * X（旧 Twitter）ユーザー名の正規化。先頭の "@" を除去し前後空白を落とす。
 * バリデーション（半角英数字とアンダースコア・16 文字以内）は呼び出し側で行う。
 */
export function normalizeXAccount(input: string): string {
  return input.trim().replace(/^@+/, "");
}
