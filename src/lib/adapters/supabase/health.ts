import { getSupabaseServerClient } from "./client";

export type SupabaseHealthCheckResult = { ok: true } | { ok: false; message: string };

/**
 * ローカル Supabase への疎通を確認する（M0 の最小実装）。
 *
 * M0 時点では public スキーマにテーブルが 1 つも存在しないため、
 * 存在しないテーブルへの select を実行し、
 * 「テーブルが無い」というエラー（PostgREST 経由で Postgres まで到達した証拠）が
 * 返ってくれば疎通成功、fetch 自体が失敗すれば疎通失敗とみなす。
 */
export async function checkSupabaseConnection(): Promise<SupabaseHealthCheckResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("__bocchi_connectivity_check__").select("*").limit(1);

    if (!error) {
      return { ok: true };
    }

    // PGRST205: スキーマキャッシュにテーブルが見つからない
    // 42P01: relation "..." does not exist（Postgres 側のエラーコード）
    // いずれも「Supabase (PostgREST 経由の Postgres) までは到達できている」ことを示す
    if (error.code === "PGRST205" || error.code === "42P01") {
      return { ok: true };
    }

    return { ok: false, message: `${error.code ?? "unknown"}: ${error.message}` };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "不明なエラーが発生しました",
    };
  }
}
