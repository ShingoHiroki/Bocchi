# Bocchi

カンファレンスや懇親会などのイベントで「1人ぼっち」になるのを回避するためのアプリ。

同じイベントに参加している人同士をつなぎ、話し相手やグループを見つけやすくすることが目的。

詳細は `AGENTS.md`、企画・設計ドキュメントは `docs/` を参照。

## セットアップ

### 前提ツール

- Node.js（`npm` 同梱）
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- Docker（ローカル Supabase の実行に必要。Docker Desktop 等でデーモンを起動しておくこと）

### 手順

1. 依存パッケージをインストールする

   ```bash
   npm install
   ```

2. ローカル Supabase を起動する（初回は Docker イメージのダウンロードで数分かかることがある）

   ```bash
   supabase start
   ```

   起動後に表示される `API_URL` / `ANON_KEY` の値を控える（`supabase status` でいつでも再確認できる）。

3. `.env.local` を作成する

   ```bash
   cp .env.local.example .env.local
   ```

   `.env.local` の値を、手順 2 で確認したローカル Supabase の `API_URL` / `ANON_KEY` に合わせる
   （デフォルトのポート番号のままであれば `.env.local.example` の値をそのままコピーすれば動く）。

4. 開発サーバーを起動する

   ```bash
   npm run dev
   ```

   [http://localhost:3000](http://localhost:3000) を開き、「ローカル Supabase 接続: OK」と表示されれば疎通確認完了。

### その他のコマンド

開発コマンド全般（lint・format・Supabase 停止・マイグレーション適用など）は `AGENTS.md` の
「開発コマンド」節を参照。

## コンテナでの起動（オプション）

普段の開発はホストの `npm run dev` を使うが、コンテナ（本番相当ビルド）でも動かせる。
ローカル Supabase（`supabase start`）と `.env.local` は上記手順どおり用意しておくこと。

```bash
docker compose up --build
```

[http://localhost:3000](http://localhost:3000) で疎通確認できる。
コンテナ内からはホスト上のローカル Supabase に `host.docker.internal` 経由で接続する
（`docker-compose.yml` で上書き済み）。

なお、ローカル Supabase 自体のコンテナ群は Supabase CLI が管理しており、
この compose には含まれない（設定は `supabase/config.toml`）。

## 注意

- Vercel デプロイ・クラウド Supabase への接続はユーザーが手動で行う（`AGENTS.md` 参照）。
