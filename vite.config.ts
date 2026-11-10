import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath, type Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;
const root = import.meta.dirname;
const moduleId = (file: string) => normalizePath(path.resolve(root, file));
const SHELL_ROUTES = new Set(["/_app", "/_app/_workspace", "/_app/_workspace/"]);
const ICON_BARREL = /lucide-react[\\/]dist[\\/]esm[\\/]lucide-react\.mjs$/;
const REACT_CORE =
  /node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler|@tanstack[\\/][^\\/]+|zustand|use-sync-external-store)[\\/]/;
const startupModules = new Set<string>();
const backgroundModules = new Set<string>();

export default defineConfig(async () => ({
  plugins: [
    {
      name: "reload-on-shared-module-change",
      hotUpdate({ modules }) {
        if (
          this.environment.name !== "client" ||
          modules.every((m) => m.type !== "js" || m.isSelfAccepting)
        )
          return;
        this.environment.hot.send({ type: "full-reload" });
        return [];
      },
    } satisfies Plugin,
    {
      name: "dev-logo",
      configureServer(server) {
        server.middlewares.use("/logo.png", (_req, res) => {
          res.setHeader("Content-Type", "image/png");
          res.end(readFileSync(path.resolve(import.meta.dirname, "src-tauri/icons/dev/icon.png")));
        });
      },
    } satisfies Plugin,
    {
      name: "scope-tailwind-property-fallback",
      apply: "build",
      enforce: "post",
      generateBundle(_, bundle) {
        for (const asset of Object.values(bundle)) {
          if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) continue;
          const css = String(asset.source);
          if (!css.includes("@layer properties")) continue;
          const scoped = css.replace(
            "*,:before,:after,::backdrop{--tw-",
            ".tw-no-property,.tw-no-property *,.tw-no-property :before,.tw-no-property :after,.tw-no-property ::backdrop{--tw-",
          );
          if (scoped === css)
            throw new Error(`Tailwind property fallback not found in ${asset.fileName}`);
          asset.source = scoped;
        }
      },
    } satisfies Plugin,
    {
      name: "startup-modules",
      apply: "build",
      buildEnd(error) {
        if (error) return;
        const collect = (id: string, into: Set<string>) => {
          if (into.has(id)) return;
          into.add(id);
          if (ICON_BARREL.test(id)) return;
          for (const dependency of this.getModuleInfo(id)?.importedIds ?? [])
            collect(dependency, into);
        };
        const early = new Set<string>();
        collect(moduleId("src/main.tsx"), early);
        startupModules.clear();
        collect(moduleId("src/bootstrap.tsx"), startupModules);
        if (startupModules.size < 2) throw new Error("Startmodule nicht gefunden");
        backgroundModules.clear();
        collect(moduleId("src/lib/background-services.ts"), backgroundModules);
        if (backgroundModules.size < 2) throw new Error("Hintergrundmodule nicht gefunden");
        for (const id of early) startupModules.delete(id);
        for (const id of [...early, ...startupModules]) backgroundModules.delete(id);
      },
    } satisfies Plugin,
    {
      name: "startup-html",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler(html, { bundle }) {
          const chunks = new Map(
            Object.values(bundle ?? {}).flatMap((chunk) =>
              chunk.type === "chunk" ? [[chunk.fileName, chunk] as const] : [],
            ),
          );
          const bootstrap = moduleId("src/bootstrap.tsx");
          const entry = [...chunks.values()].find((chunk) =>
            chunk.moduleIds.some((id) => normalizePath(id) === bootstrap),
          );
          if (!entry) throw new Error("Start-Chunk fehlt");
          const startup = new Set<string>();
          const collect = (fileName: string) => {
            if (startup.has(fileName)) return;
            startup.add(fileName);
            for (const dependency of chunks.get(fileName)?.imports ?? []) collect(dependency);
          };
          collect(entry.fileName);
          const links = [
            ...[...startup]
              .flatMap((fileName) => [...(chunks.get(fileName)?.viteMetadata?.importedCss ?? [])])
              .filter((file) => !html.includes(`/${file}"`))
              .map((file) => `    <link rel="stylesheet" crossorigin href="/${file}">\n`),
            ...[...startup]
              .filter((fileName) => !html.includes(`/${fileName}"`))
              .map(
                (fileName) => `    <link rel="modulepreload" crossorigin href="/${fileName}">\n`,
              ),
          ];
          return html.replace("</head>", `${links.join("")}  </head>`);
        },
      },
    } satisfies Plugin,
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      codeSplittingOptions: {
        splitBehavior: ({ routeId }) => (SHELL_ROUTES.has(routeId) ? [] : undefined),
      },
    }),
    react(),
    tailwindcss(),
  ],

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
      "sql-formatter",
    ],
  },

  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "boot", tags: ["$initial" as const], priority: 6 },
            {
              name: "startup-react",
              test: (id: string) => startupModules.has(id) && REACT_CORE.test(id),
              priority: 5,
            },
            {
              name: "startup-vendor",
              test: (id: string) => startupModules.has(id) && id.includes("node_modules"),
              priority: 4,
            },
            { name: "startup", test: (id: string) => startupModules.has(id), priority: 3 },
            {
              name: "background",
              test: (id: string) => backgroundModules.has(id),
              priority: 2,
            },
            { name: "icons", test: /node_modules[\\/].*lucide-react[\\/]/, priority: 1 },
          ],
        },
      },
    },
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
