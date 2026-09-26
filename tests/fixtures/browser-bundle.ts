import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function bundleFixture(entry: string) {
  const bundle = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    plugins: [
      {
        name: "fixture-resolver",
        setup(build) {
          build.onResolve({ filter: /^@\/lib\/db$/ }, () => ({
            path: "db-stub",
            namespace: "fixture-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture-stub" }, () => ({
            contents:
              "export async function readCommunityExtension(){ throw new Error('unavailable') }",
            loader: "js",
          }));
          build.onResolve({ filter: /^@\// }, (args) => {
            const base = resolve("src", args.path.slice(2));
            const path = [
              base,
              `${base}.ts`,
              `${base}.tsx`,
              `${base}.js`,
              `${base}/index.ts`,
              `${base}/index.tsx`,
            ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
            if (!path) throw new Error(`Missing fixture module: ${args.path}`);
            return { path };
          });
          build.onResolve({ filter: /\.js\?raw$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path),
            namespace: "raw-asset",
          }));
          build.onResolve({ filter: /\?raw$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path),
            namespace: "raw-asset",
          }));
          build.onLoad({ filter: /\?raw$/, namespace: "raw-asset" }, async (args) => ({
            contents: `export default ${JSON.stringify(await readFile(args.path.replace(/\?raw$/, ""), "utf8"))}`,
            loader: "js",
          }));
          build.onResolve({ filter: /\?url$/ }, (args) => ({
            path: args.path,
            namespace: "url-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "url-stub" }, () => ({
            contents: 'export default ""',
            loader: "js",
          }));
          build.onResolve({ filter: /\?worker$/ }, (args) => ({
            path: args.path,
            namespace: "worker-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "worker-stub" }, () => ({
            contents: "export default class WorkerStub {}",
            loader: "js",
          }));
        },
      },
    ],
  });
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  return bundle.outputs[0];
}
