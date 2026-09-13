import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/moonlight-api": {
        target: "https://www.themoonlight.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/moonlight-api/, "/api"),
      },
      "/semantic-scholar-api": {
        target: "https://api.semanticscholar.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/semantic-scholar-api/, "/graph/v1"),
      },
      "/huggingface-api": {
        target: "https://huggingface.co",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/huggingface-api/, "/api"),
      },
      "/openreview-api": {
        target: "https://api2.openreview.net",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/openreview-api/, ""),
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "oxc",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
