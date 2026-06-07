/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";

const nextConfig = {
  reactStrictMode: true,
  // 本番ではソースマップを無効化（セキュリティ）
  productionBrowserSourceMaps: false,
  // ESM onlyパッケージをCJS互換にトランスパイル（ERR_REQUIRE_ESM対策）
  transpilePackages: [
    "@supabase/supabase-js",
    "@supabase/auth-js",
    "@supabase/postgrest-js",
    "@supabase/realtime-js",
    "@supabase/storage-js",
    "@supabase/functions-js",
  ],
  // API プロキシ（環境変数で切り替え）
  async rewrites() {
    return [
      {
        source: "/api/report/:path*",
        destination: "/api/report/:path*", // レポートAPI はNext.js内部で処理
      },
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
  // === 壁6: セキュリティヘッダー ===
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // wsモジュールのESM問題回避（サーバーサイドではNode.js組み込みを使用）
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({ ws: "commonjs ws" });
    }
    return config;
  },
  // 画像の外部ドメイン許可（Supabase Storage等）
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
