import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase クライアントの生成をこのファイルに閉じ込める。
 *
 * 方針（CLAUDE.md・docs/implementation-plan.md 4節）:
 * - `@supabase/supabase-js` は `src/lib/adapters/supabase/` 配下からのみ import する
 * - UI・ドメインロジックは `src/lib/domain/interfaces/` のインターフェース越しにのみデータ操作を行い、
 *   ここで生成したクライアントやこのファイルを直接 import しない
 * - サーバー側（Route Handler / Server Component / Server Action）からのみ利用する想定（R2）
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env.local を確認してください（.env.local.example を参照）。`,
    );
  }
  return value;
}

let cachedClient: SupabaseClient | null = null;
let cachedServiceRoleClient: SupabaseClient | null = null;

/**
 * サーバー側専用の Supabase クライアントを取得する（anon key を使用）。
 * リクエストごとに作り直す必要はないため、プロセス内でキャッシュする。
 * M0 の疎通確認用。RLS が有効なテーブルへの実データ操作は
 * `getSupabaseServiceRoleClient()` を使う。
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
    },
  });

  return cachedClient;
}

/**
 * サーバー側専用の Supabase クライアント（service_role キー）を取得する。
 *
 * 方針（R2）:
 * - service_role キーはブラウザに渡してはいけない（`SUPABASE_SERVICE_ROLE_KEY` に `NEXT_PUBLIC_` を付けない）。
 * - この関数は Server Component / Server Action / Route Handler からのみ呼ぶ。
 * - service_role は RLS をバイパスするため、全テーブルへアクセスできる。Repository 実装はこれを使う。
 */
export function getSupabaseServiceRoleClient(): SupabaseClient {
  if (cachedServiceRoleClient) {
    return cachedServiceRoleClient;
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  cachedServiceRoleClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedServiceRoleClient;
}
