import { expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

async function reachable(start: string): Promise<Set<string>> {
  const reached = new Set<string>();
  const visit = async (file: string) => {
    if (reached.has(file)) return;
    reached.add(file);
    const extension = file.match(/\.(tsx?)$/)?.[1] as "ts" | "tsx" | undefined;
    if (!extension) return;
    for (const entry of transpilers[extension].scanImports(await Bun.file(file).text())) {
      const target = entry.path.startsWith("@/")
        ? resolve(root, "src", entry.path.slice(2))
        : entry.path.startsWith(".")
          ? resolve(dirname(file), entry.path)
          : null;
      if (target && !entry.path.includes("?")) await visit(Bun.resolveSync(target, root));
    }
  };
  await visit(resolve(root, start));
  return new Set([...reached].map((file) => relative(root, file).replaceAll("\\", "/")));
}

test("stores never import the router, so hot reload cannot duplicate them", async () => {
  for (const store of [
    "src/lib/connections/store.ts",
    "src/lib/table-tabs/store.ts",
    "src/lib/settings.ts",
    "src/lib/buffered-storage.ts",
    "src/lib/ssh/activation.ts",
  ]) {
    const modules = await reachable(store);
    expect(modules.size).toBeGreaterThan(1);
    expect([store, modules.has("src/router.ts")]).toEqual([store, false]);
  }
});
