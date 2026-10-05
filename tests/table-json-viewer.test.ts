import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import manifest from "../extention/table-json-viewer/l8db-extension.json";
import { assembleTableJson, detectMapping } from "../extention/table-json-viewer/src/assemble";
import { activate } from "../extention/table-json-viewer/src/extension";
import type {
  ExtensionContext,
  Json,
  JsonPanelOptions,
  L8dbApi,
  TableSnapshot,
} from "../packages/extension-api/src";
import { validateArchive, validateManifest } from "../packages/extension-api/src/manifest";

const columns = [
  "REF",
  "REF_KOPF",
  "POS_NR",
  "EBENE",
  "SUBTAG",
  "WERT_NAME",
  "WERT_INHALT",
  "WERT_ATTR",
  "WERT_CLOB",
];
const fields = [
  ["Location", "Meppen"],
  ["Warehouse", "Meppen"],
  ["Client", "buah"],
  ["OrderStatus", "planed"],
  ["OrderNumber", "2026DE1733663"],
  ["OrderReferenz", null],
  ["OrderCommNumber", null],
  ["PurchaseNumber", null],
  ["DeliveryNoteNumber", "LS102082020"],
  ["DeliveryDate", "2026-09-30"],
  ["ProcessTimestamp", "2026-10-02T13:24:45+02:00"],
] as const;

function row(
  name: string,
  level: number,
  position: number,
  value: string | null = null,
  group = "10271",
) {
  return {
    REF: String(833903782 + position),
    REF_KOPF: group,
    POS_NR: String(position),
    EBENE: String(level),
    SUBTAG: "0",
    WERT_NAME: name,
    WERT_INHALT: value,
    WERT_ATTR: null,
    WERT_CLOB: null,
  };
}

function snapshot(
  rows = [
    ...fields.map(([name, value], index) => row(name, 2, index + 2, value)),
    { ...row("DeliveryOrderResponse", 1, 1), SUBTAG: "1" },
  ],
): TableSnapshot {
  return {
    connectionId: "fixture",
    database: "test",
    schema: "public",
    table: "responses",
    filter: "REF_KOPF = 10271",
    columns,
    rows,
  };
}

function assemble(table: TableSnapshot) {
  const mapping = detectMapping(table.columns);
  if (!mapping) throw new Error("Missing mapping");
  return assembleTableJson(table, mapping);
}

function harness(picks: (string | undefined)[] = [], entrypoint = activate) {
  type Handler = Parameters<L8dbApi["commands"]["registerCommand"]>[1];
  const commands = new Map<string, Handler>();
  const storage = new Map<string, Json>();
  const panels: { id: string; options: JsonPanelOptions }[] = [];
  const notifications: string[] = [];
  const api = {
    commands: {
      registerCommand: (id: string, handler: Handler) => {
        commands.set(id, handler);
        return { dispose: () => commands.delete(id) };
      },
    },
    storage: {
      get: async (key: string) => storage.get(key) ?? null,
      set: async (key: string, value: Json) => {
        storage.set(key, value);
      },
    },
    window: {
      showQuickPick: async () => {
        const label = picks.shift();
        return label === undefined ? undefined : [{ label }];
      },
    },
    notifications: {
      showInfo: async (message: string) => {
        notifications.push(message);
      },
    },
    panels: {
      openJson: async (id: string, options: JsonPanelOptions) => {
        panels.push({ id, options });
      },
    },
  } as unknown as L8dbApi;
  entrypoint({ subscriptions: [] } as unknown as ExtensionContext, api);
  return { commands, storage, panels, notifications };
}

describe("TableJSONViewer", () => {
  test("reconstructs the supplied table with the root row last", () => {
    expect(assemble(snapshot())).toEqual({
      documents: 1,
      value: { DeliveryOrderResponse: Object.fromEntries(fields) },
    });
  });

  test("keeps values intact, uses CLOB for NULL, and preserves empty objects", () => {
    const table = snapshot([
      { ...row("LongText", 1, 1), WERT_CLOB: "a".repeat(2000) },
      { ...row("EmptyString", 1, 2, ""), WERT_CLOB: "fallback" },
      row("Number", 1, 3, "9007199254740993"),
      row("NullText", 1, 4, "NULL"),
      { ...row("EmptyObject", 1, 5), SUBTAG: "1" },
    ]);
    expect(assemble(table).value).toEqual({
      LongText: "a".repeat(2000),
      EmptyString: "",
      Number: "9007199254740993",
      NullText: "NULL",
      EmptyObject: {},
    });
  });

  test("repeated nested names form arrays and document groups stay separate", () => {
    const table = snapshot([
      row("Response", 1, 1),
      row("Item", 2, 2),
      row("Name", 3, 3, "First"),
      row("Item", 2, 4),
      row("Name", 3, 5, "Second"),
      row("Response", 1, 1, null, "10272"),
      row("Name", 2, 2, "Other", "10272"),
    ]);
    expect(assemble(table)).toEqual({
      documents: 2,
      value: [
        { Response: { Item: [{ Name: "First" }, { Name: "Second" }] } },
        { Response: { Name: "Other" } },
      ],
    });
  });

  test("supports a filtered subtree and safely handles special JSON keys", () => {
    const table = snapshot([row("__proto__", 2, 1, "safe"), row("constructor", 2, 2, "also safe")]);
    expect(JSON.stringify(assemble(table).value)).toBe(
      '{"__proto__":"safe","constructor":"also safe"}',
    );
    expect(Object.getPrototypeOf(assemble(table).value)).toBe(Object.prototype);
    expect(assemble(snapshot([]))).toEqual({ value: {}, documents: 0 });
  });

  test("rejects missing parents, invalid positions, and mixed scalar/container nodes", () => {
    expect(() => assemble(snapshot([row("Root", 1, 1), row("Child", 3, 2)]))).toThrow(
      "Übergeordneter",
    );
    expect(() => assemble(snapshot([{ ...row("Root", 1, 1), POS_NR: "no" }]))).toThrow("Position");
    expect(() => assemble(snapshot([{ ...row("Root", 1, 1), EBENE: "129" }]))).toThrow("Ebene");
    expect(() => assemble(snapshot([row("Root", 1, 1, "value"), row("Child", 2, 2)]))).toThrow(
      "sowohl",
    );
    expect(() => assemble(snapshot([row("", 1, 1)]))).toThrow("Name fehlt");
  });

  test("detects common column names without requiring the example schema", () => {
    expect(detectMapping(["level", "position", "name", "value", "content"])).toEqual({
      level: "level",
      position: "position",
      name: "name",
      value: "value",
      content: "content",
      group: null,
      container: null,
    });
    expect(detectMapping(["x"])).toBeNull();
  });

  test("opens the native viewer from the table command", async () => {
    const { commands, panels } = harness();
    await commands.get("tablejson.show")?.(snapshot() as unknown as Json);
    expect(panels).toHaveLength(1);
    expect(panels[0].id).toBe("tablejson.document");
    expect(JSON.parse(panels[0].options.text)).toEqual({
      DeliveryOrderResponse: Object.fromEntries(fields),
    });
    expect(panels[0].options.description).toContain("12 Zeilen · 1 Dokument");
    expect(panels[0].options.description).toContain("REF_KOPF = 10271");
  });

  test("saves an explicit mapping per table and cancellation leaves no panel", async () => {
    const configured = harness([
      "EBENE",
      "POS_NR",
      "WERT_NAME",
      "WERT_INHALT",
      "Keine Spalte",
      "REF_KOPF",
      "SUBTAG",
    ]);
    await configured.commands.get("tablejson.configure")?.(snapshot() as unknown as Json);
    expect(configured.storage.get("mappings")).toBeDefined();
    await configured.commands.get("tablejson.show")?.(snapshot() as unknown as Json);
    expect(configured.panels).toHaveLength(2);
    const cancelled = harness();
    await cancelled.commands.get("tablejson.configure")?.(snapshot() as unknown as Json);
    expect(cancelled.storage.size).toBe(0);
    expect(cancelled.panels).toHaveLength(0);
  });

  test("empty filters and invalid payloads do not open a viewer", async () => {
    const { commands, panels, notifications } = harness();
    await commands.get("tablejson.show")?.(snapshot([]) as unknown as Json);
    expect(notifications).toEqual(["Keine Zeilen für diesen Filter."]);
    await expect(Promise.resolve(commands.get("tablejson.show")?.({ rows: [] }))).rejects.toThrow(
      "Tabellendaten",
    );
    expect(panels).toHaveLength(0);
  });

  test("is a locally installable community extension with minimal permissions", () => {
    const validated = validateManifest(manifest);
    expect(validated.publisher).toBe("community");
    expect(validated.permissions).toEqual(["database:read", "filesystem:extension-storage"]);
    expect(validated.contributes?.menus?.every((menu) => menu.location === "table/toolbar")).toBe(
      true,
    );
  });

  test("the packaged extension executes without imports or access to app internals", async () => {
    const archive = validateArchive(
      JSON.parse(
        await readFile(
          new URL(
            "../extention/table-json-viewer/community.table-json-viewer-0.1.0.l8db-extension",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const module = { exports: {} as { activate: typeof activate } };
    new Function("module", "exports", archive.files[archive.manifest.main])(module, module.exports);
    const { commands, panels } = harness([], module.exports.activate);
    await commands.get("tablejson.show")?.(snapshot() as unknown as Json);
    expect(JSON.parse(panels[0].options.text)).toEqual({
      DeliveryOrderResponse: Object.fromEntries(fields),
    });
  });
});
