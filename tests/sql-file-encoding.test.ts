import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let picked: string | null = null;
let onRead: (() => void) | null = null;
const commands: string[] = [];
const storeWindow = new EventTarget();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: Object.assign(storeWindow, {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    __TAURI_INTERNALS__: {
      invoke: async (
        command: string,
        args?: { path?: string } | Uint8Array,
        options?: { headers?: Record<string, string> },
      ) => {
        commands.push(command);
        if (command === "plugin:dialog|open" || command === "plugin:dialog|save") return picked;
        const raw = options?.headers?.path;
        const path = raw ? decodeURIComponent(raw) : (args as { path?: string })?.path;
        if (!path?.startsWith(`${root}/`)) throw Error("Unexpected fixture path");
        if (command === "plugin:fs|stat") {
          const info = await stat(path);
          return { mtime: info.mtime.toISOString(), size: info.size };
        }
        if (command === "plugin:fs|read_file") {
          const bytes = await readFile(path);
          onRead?.();
          return bytes;
        }
        if (command === "plugin:fs|write_text_file" && args instanceof Uint8Array) {
          const opts = JSON.parse(options?.headers?.options ?? "{}");
          await writeFile(path, args, { flag: opts.createNew ? "wx" : "w" });
          return;
        }
        throw Error(`Unexpected IPC: ${command}`);
      },
    },
  }),
});

const { decodeSqlFile, decodeSqlText, MAX_SQL_FILE_BYTES } = await import("../src/lib/sql-file");
const { openSqlPathAsTab, openSqlFileAsTab, saveQueryTabFile, reloadQueryTabFile } = await import(
  "../src/lib/hooks/use-query-file"
);
const { useTableTabs, isQueryTabDirty } = await import("../src/lib/table-tabs");

function tab(id: string) {
  const current = useTableTabs.getState().tabs.find((tab) => tab.kind === "query" && tab.id === id);
  if (current?.kind !== "query") throw Error("Query tab missing");
  return current;
}

async function openFixtureTab(path: string, encoding?: "utf-16le" | "utf-16be") {
  const id = await openSqlPathAsTab(path, encoding);
  if (!id) throw Error("Fixture did not open");
  return id;
}

const sample = "SELECT 'Grüße € 東京 🧪';\r\n";
const utf16 = (text: string, be = false) => {
  const bytes = Buffer.from(`\uFEFF${text}`, "utf16le");
  return be ? bytes.swap16() : bytes;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "l8db-a24-files-"));
  picked = null;
  onRead = null;
  commands.length = 0;
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, recentlyClosed: [] });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("auto keeps UTF-8 and Windows-1252 decoding, with no implicit UTF-16 decode", () => {
  const utf8 = new TextEncoder().encode(`\uFEFF${sample}`);
  expect(decodeSqlFile(utf8)).toEqual({ text: sample, requiresUtf8Copy: false });
  const windows = new Uint8Array([0x5a, 0xe4, 0x68, 0x6c, 0x80]);
  expect(decodeSqlFile(windows)).toEqual({ text: "Zähl€", requiresUtf8Copy: true });
  expect(decodeSqlText(windows)).toBe("Zähl€");
  expect(decodeSqlFile(utf16(sample))).toMatchObject({ requiresUtf8Copy: true });
  expect(decodeSqlText(utf16(sample))).not.toBe(sample);
  expect(decodeSqlFile(Buffer.from("select 1", "utf16le")).requiresUtf8Copy).toBe(true);
});

test("explicit UTF-16 LE and BE preserve characters and reject invalid sequences or wrong BOM", () => {
  expect(decodeSqlFile(utf16(sample), "utf-16le").text).toBe(sample);
  expect(decodeSqlFile(utf16(sample, true), "utf-16be").text).toBe(sample);
  expect(decodeSqlFile(Buffer.from(sample, "utf16le"), "utf-16le").text).toBe(sample);
  expect(() => decodeSqlFile(utf16(sample, true), "utf-16le")).toThrow("Dateimarkierung");
  expect(() => decodeSqlFile(new Uint8Array([0x61]), "utf-16le")).toThrow("Ungültige Dateibytes");
  expect(() => decodeSqlFile(new Uint8Array([0x00, 0xd8]), "utf-16le")).toThrow(
    "Ungültige Dateibytes",
  );
});

test("normal UTF-8 saves still write the bound file and keep external-change protection", async () => {
  const path = join(root, "normal.sql");
  await writeFile(path, "SELECT 1;", "utf8");
  const id = await openFixtureTab(path);
  useTableTabs.getState().setQueryTabExternalChange(id, true);
  useTableTabs.getState().updateQuerySql(id, sample);
  expect(await saveQueryTabFile(id)).toBe(false);
  expect(await readFile(path, "utf8")).toBe("SELECT 1;");
  useTableTabs.getState().setQueryTabExternalChange(id, false);
  expect(await saveQueryTabFile(id)).toBe(true);
  expect(await readFile(path, "utf8")).toBe(sample);
  expect(isQueryTabDirty(tab(id))).toBe(false);
});

test("protected save uses a new UTF-8 path and preserves the source even through a symlink alias", async () => {
  const path = join(root, "source.sql");
  const alias = join(root, "alias.sql");
  const copy = join(root, "copy.sql");
  const bytes = utf16(sample, true);
  await writeFile(path, bytes);
  await symlink(path, alias);
  const id = await openFixtureTab(path, "utf-16be");
  expect(tab(id)).toMatchObject({
    sql: sample,
    fileReadEncoding: "utf-16be",
    fileRequiresUtf8Copy: true,
  });
  useTableTabs.getState().updateQuerySql(id, `${sample}SELECT 2;`);
  expect(await saveQueryTabFile(id)).toBe(false);
  picked = path;
  expect(await saveQueryTabFile(id, true)).toBe(false);
  picked = alias;
  expect(await saveQueryTabFile(id)).toBe(false);
  expect(await readFile(path)).toEqual(bytes);
  expect(isQueryTabDirty(tab(id))).toBe(true);
  picked = copy;
  expect(await saveQueryTabFile(id)).toBe(true);
  expect(await readFile(path)).toEqual(bytes);
  expect(await readFile(copy, "utf8")).toBe(`${sample}SELECT 2;`);
  expect(tab(id)).toMatchObject({
    filePath: copy,
    fileReadEncoding: undefined,
    fileRequiresUtf8Copy: undefined,
  });
  expect(isQueryTabDirty(tab(id))).toBe(false);
  useTableTabs.getState().updateQuerySql(id, "SELECT 'neu';");
  expect(await saveQueryTabFile(id)).toBe(true);
  expect(await readFile(copy, "utf8")).toBe("SELECT 'neu';");
});

test("reload preserves the chosen mode, leaves malformed bytes and concurrent editor updates unapplied", async () => {
  const path = join(root, "reload.sql");
  await writeFile(path, utf16(sample));
  const id = await openFixtureTab(path, "utf-16le");
  await writeFile(path, utf16("SELECT 'neu';"));
  expect(await reloadQueryTabFile(id)).toBe(true);
  expect(tab(id)).toMatchObject({ sql: "SELECT 'neu';", fileReadEncoding: "utf-16le" });
  useTableTabs.getState().updateQuerySql(id, "draft");
  const before = tab(id);
  await writeFile(path, new Uint8Array([0x0f]));
  expect(await reloadQueryTabFile(id)).toBe(false);
  expect(tab(id)).toEqual(before);
  await writeFile(path, utf16(sample));
  onRead = () => useTableTabs.getState().updateQuerySql(id, "newer draft");
  expect(await reloadQueryTabFile(id)).toBe(false);
  expect(tab(id).sql).toBe("newer draft");
  onRead = null;
  await writeFile(path, "SELECT 1;", "utf8");
  expect(await reloadQueryTabFile(id, "auto")).toBe(true);
  expect(tab(id)).toMatchObject({
    sql: "SELECT 1;",
    fileReadEncoding: "auto",
    fileRequiresUtf8Copy: true,
  });
});

test("a canceled picker does not read and existing dirty tabs are not replaced", async () => {
  expect(await openSqlFileAsTab("utf-16le")).toBeNull();
  expect(commands).toEqual(["plugin:dialog|open"]);
  const path = join(root, "opened.sql");
  await writeFile(path, utf16(sample));
  const id = await openFixtureTab(path);
  useTableTabs.getState().updateQuerySql(id, "draft");
  const count = commands.length;
  expect(await openSqlPathAsTab(path, "utf-16le")).toBe(id);
  expect(commands).toHaveLength(count);
  expect(tab(id).sql).toBe("draft");
});

test("size protection applies to opening and reloading before reading", async () => {
  const path = join(root, "oversized.sql");
  await writeFile(path, "start");
  const id = await openFixtureTab(path);
  await writeFile(path, Buffer.alloc(MAX_SQL_FILE_BYTES + 1));
  commands.length = 0;
  expect(await reloadQueryTabFile(id, "utf-16le")).toBe(false);
  expect(commands).toEqual(["plugin:fs|stat"]);
  expect(tab(id).sql).toBe("start");
});
