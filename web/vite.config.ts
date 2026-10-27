import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { "@": path.join(root, "src") } },
  css: { postcss: path.join(root, "postcss.config.js") },
  build: {
    outDir: path.join(root, "../dist/web"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Charts are the heaviest dependency; everything else from node_modules
        // shares one vendor chunk (splitting React apart breaks module order).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(recharts|d3-|victory-vendor|decimal\.js-light|internmap)/.test(id)) return "charts";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.ORLA_API_URL ?? "http://127.0.0.1:81", changeOrigin: false },
    },
  },
});
