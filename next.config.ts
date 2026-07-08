import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker イメージ化のため standalone 出力を使う（Vercel でのビルドには影響しない）
  output: "standalone",
};

export default nextConfig;
