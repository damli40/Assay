import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, ".", "").HOST_TARGET || "http://localhost:8787";
  // The host sends no CORS headers, so the dev and preview servers serve it under /host.
  const proxy = { "/host": { target, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/host/, "") } };
  return {
    // Two pages on one origin: the landing at / and the app at /app/, so passkeys work in both.
    build: { rolldownOptions: { input: { landing: "index.html", app: "app/index.html" } } },
    server: { proxy },
    preview: { proxy },
    test: { environment: "node" },
  };
});
