import { type SqlSplitResult, splitSqlStatements } from "./split";

export interface ScriptItem {
  kind: "sql" | "command" | "error";
  text: string;
  start: number;
  end: number;
  source?: string;
  error?: string;
}

export interface IncludeContext {
  file: string | null;
  searchPath: string[];
  read: (path: string) => Promise<string>;
}

export const INCLUDE_LIMITS = { depth: 10, items: 100_000, characters: 10 * 1024 * 1024 } as const;

const INCLUDE_PATTERN = /^(@@?|STA(?:RT)?\s)\s*("[^"]+"|'[^']+'|\S+)/i;

export function includeTarget(text: string): { name: string; nested: boolean } | null {
  const match = INCLUDE_PATTERN.exec(text.trim());
  if (!match) return null;
  const name = match[2].replace(/^(["'])(.*)\1$/, "$2").replace(/;$/, "");
  return { name, nested: match[1] === "@@" };
}

export function scriptItems({ statements, commands }: SqlSplitResult): ScriptItem[] {
  const items: ScriptItem[] = [
    ...statements.map((part) => ({ kind: "sql" as const, ...part })),
    ...commands.map((part) => ({ kind: "command" as const, ...part })),
  ];
  return commands.length ? items.sort((a, b) => a.start - b.start) : items;
}

function dirname(path: string): string | null {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? null : path.slice(0, index) || path.slice(0, 1);
}

function join(dir: string, file: string): string {
  if (/[\\/]$/.test(dir)) return `${dir}${file}`;
  return `${dir}${dir.includes("\\") && !dir.includes("/") ? "\\" : "/"}${file}`;
}

export function includeCandidates(name: string, dirs: (string | null)[]): string[] {
  const file = /\.[^\\/.]+$/.test(name) ? name : `${name}.sql`;
  if (/^([\\/]|[A-Za-z]:[\\/])/.test(file)) return [file];
  return [...new Set(dirs.filter((dir): dir is string => Boolean(dir)))].map((dir) =>
    join(dir, file),
  );
}

export async function expandIncludes(
  items: ScriptItem[],
  context: IncludeContext,
): Promise<ScriptItem[]> {
  const cache = new Map<string, string>();
  const out: ScriptItem[] = [];
  const top = context.file ? dirname(context.file) : null;
  const read = async (path: string) => {
    const cached = cache.get(path) ?? (await context.read(path));
    cache.set(path, cached);
    return cached;
  };
  const visit = async (
    list: ScriptItem[],
    dir: string | null,
    stack: string[],
    anchor: { start: number; end: number } | null,
    depth: number,
  ) => {
    for (const item of list) {
      if (out.length >= INCLUDE_LIMITS.items)
        throw new Error(
          `Das Skript enthält mit seinen @-Dateien mehr als ${INCLUDE_LIMITS.items} Einträge.`,
        );
      const placed = anchor ? { ...item, ...anchor } : item;
      const target = item.kind === "command" ? includeTarget(item.text) : null;
      if (!target) {
        out.push(placed);
        continue;
      }
      const fail = (error: string) => out.push({ ...placed, kind: "error", error });
      if (depth >= INCLUDE_LIMITS.depth) {
        fail(
          `@-Aufrufe sind höchstens ${INCLUDE_LIMITS.depth} Ebenen tief erlaubt: ${target.name}`,
        );
        continue;
      }
      const candidates = includeCandidates(
        target.name,
        target.nested ? [dir] : [dir, top, ...context.searchPath],
      );
      if (!candidates.length) {
        fail(
          `Datei nicht gefunden: ${target.name}. Relative Pfade werden über den Ordner der gespeicherten Skriptdatei oder SQLPATH aufgelöst.`,
        );
        continue;
      }
      let found: { path: string; text: string } | null = null;
      for (const path of candidates) {
        found = await read(path).then(
          (text) => ({ path, text }),
          () => null,
        );
        if (found) break;
      }
      if (!found) {
        fail(`Datei nicht gefunden: ${target.name} (gesucht: ${candidates.join(", ")})`);
        continue;
      }
      if (stack.includes(found.path)) {
        fail(`Zyklischer @-Aufruf: ${[...stack, found.path].join(" → ")}`);
        continue;
      }
      if (found.text.length > INCLUDE_LIMITS.characters) {
        fail(`Datei ist zu groß: ${found.path}`);
        continue;
      }
      const split = splitSqlStatements(found.text, "oracle");
      if (split.unterminated) {
        fail(`Nicht abgeschlossenes Literal oder Kommentar in ${found.path}`);
        continue;
      }
      const source = found.path;
      await visit(
        scriptItems(split).map((child) => ({ ...child, source })),
        dirname(source),
        [...stack, source],
        anchor ?? { start: item.start, end: item.end },
        depth + 1,
      );
    }
  };
  await visit(items, top, context.file ? [context.file] : [], null, 0);
  return out;
}
