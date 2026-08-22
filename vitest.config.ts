import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // 既定5秒だと、全ファイル同時実行時の動的import(await import("./supabase"))が
    // 間に合わずタイムアウトする。単体実行では通るのに全体実行だけ落ちて、
    // 本物の失敗と見分けがつかなくなるため余裕を持たせる（2026-08-22）
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
