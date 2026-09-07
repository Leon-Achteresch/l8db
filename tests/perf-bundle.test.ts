import { expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

test.skipIf(!process.env.L8DB_PERF_BROWSER)(
  "workspace shell keeps editors and reports out of its initial imports",
  async () => {
    const root = resolve(import.meta.dir, "../dist");
    const assets = resolve(root, "assets");
    const files = await readdir(assets);
    const html = await readFile(resolve(root, "index.html"), "utf8");
    const entry = html.match(/src="\/assets\/([^\"]+\.js)"/)?.[1];
    expect(entry).toBeDefined();
    const layouts = files.filter(
      (name) => /^_app-[^.]+\.js$/.test(name) || /^_app\._workspace-[^.]+\.js$/.test(name),
    );
    expect(layouts).toHaveLength(2);
    const visited = new Set<string>();
    let bytes = 0;
    const visit = async (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const path = resolve(assets, name);
      const source = await readFile(path, "utf8");
      bytes += (await stat(path)).size;
      for (const match of source.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g))
        await visit(match[1]);
    };
    for (const name of [entry!, ...layouts]) await visit(name);
    expect([...visited].some((name) => name.startsWith("monaco-"))).toBe(false);
    expect(bytes).toBeLessThan(2_000_000);
    console.log(`workspace imports: ${(bytes / 1_000_000).toFixed(2)} MB, ${visited.size} chunks`);
  },
);
