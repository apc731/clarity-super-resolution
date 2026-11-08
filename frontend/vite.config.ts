import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backend = env.VITE_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    // 案例页是纯静态产物，可能挂在域名根目录（Vercel），也可能挂到某个子路径
    // （CloudBase 静态托管的 /clarity/）。相对 base 让同一份 dist 两种都能用。
    base: mode === "static" ? "./" : "/",
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        // 开发模式下前端在 :3000，接口和文件都转发给 FastAPI
        "/api": { target: backend, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
