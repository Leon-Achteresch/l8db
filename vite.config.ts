import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],

  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
      { find: /^monaco-editor\/esm\/vs\/(.*)$/, replacement: "monaco-editor/$1" },
      {
        find: /^monaco-vim$/,
        replacement: path.resolve(import.meta.dirname, "./node_modules/monaco-vim/dist/index.mjs"),
      },
    ],
  },

  optimizeDeps: {
    exclude: ["thesvg", "@thesvg/icons", "monaco-vim"],
    include: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "@tanstack/react-router",
      "@tanstack/react-table",
      "@tanstack/react-virtual",
      "react-grid-layout",
      "recharts",
      "@xyflow/react",
    ],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
