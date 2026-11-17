import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { InlineConfig } from "vite";

export function arrayEditorViteConfig(): InlineConfig {
  return {
    configFile: false,
    envFile: false,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    cacheDir: "node_modules/.vite-array-development",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  };
}
