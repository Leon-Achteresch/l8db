import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

test.skipIf(!process.env.L8DB_PERF_BROWSER)(
  "start package is preloaded as a few files without editors and reports",
  async () => {
    const root = resolve(import.meta.dir, "../dist");
    const assets = resolve(root, "assets");
    const html = await readFile(resolve(root, "index.html"), "utf8");
    const entry = html.match(/<script type="module"[^>]* src="\/assets\/([^"]+\.js)"/)?.[1];
    if (!entry) throw new Error("Einstiegsskript fehlt in index.html");
    const preloads = [
      ...html.matchAll(/rel="modulepreload"[^>]* href="\/assets\/([^"]+\.js)"/g),
    ].map((match) => match[1]);
    const startup = preloads.filter((name) => name.startsWith("startup"));
    expect(startup.length).toBeGreaterThanOrEqual(1);
    const closure = async (names: string[]) => {
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
      for (const name of names) await visit(name);
      return { visited, bytes };
    };
    const early = await closure([entry]);
    expect([...early.visited].filter((name) => name.startsWith("startup"))).toEqual([]);
    const { visited, bytes } = await closure([entry, ...startup]);
    expect([...visited].sort()).toEqual([...new Set([entry, ...preloads])].sort());
    expect([...visited].some((name) => name.startsWith("monaco-"))).toBe(false);
    expect([...visited].some((name) => name.startsWith("ai-view-"))).toBe(false);
    expect(visited.size).toBeLessThanOrEqual(6);
    console.log(`start package: ${(bytes / 1_000_000).toFixed(2)} MB, ${visited.size} chunks`);
  },
);
