import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/_ui/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/_admin": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        // Disable both proxy timeouts so large uploads (multi-GB) aren't
        // killed mid-stream by node-http-proxy's default socket timeouts.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            // Rewrite Origin to satisfy the gateway's same-origin CSRF
            // check (Origin must equal http(s)://Host). changeOrigin only
            // rewrites Host; we also need to rewrite Origin for /_admin/*.
            proxyReq.setHeader("origin", "http://127.0.0.1:8081");
          });
        },
      },
      // Optional (spec §8.1): also forward S3-style paths to the gateway during dev:
      //   "^/(?!_ui/|@vite|src/|node_modules/|@react-refresh|@id/).*": {
      //     target: "http://127.0.0.1:8081",
      //     changeOrigin: true,
      //   },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
