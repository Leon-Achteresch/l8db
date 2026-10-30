import { describe, expect, test } from "bun:test";
import {
  catalogFileUrl,
  checkPluginSource,
  compilePlugin,
  httpPatternMatches,
  parseHttpPattern,
  resolveOptions,
  validateCatalog,
  validateColumnPatches,
  validatePlugin,
  validateSlots,
} from "../packages/ui-plugin-api/src";

const VALID = `import { definePlugin, Pill, type Tone } from "@l8db/ui";
import { useState } from "react";
const TONE: Record<string, Tone> = { offen: "warning", bezahlt: "success" };
export default definePlugin({
  id: "test.status",
  slots: {
    grid: {
      cell: ({ column, value, row }) =>
        column.id === "status" ? <Pill tone={TONE[String(value)]}>{String(value)} {row.location}</Pill> : undefined,
    },
  },
});
`;

function errorOf(source: string, file = "plugin.tsx") {
  const result = checkPluginSource(source, file);
  return result.ok ? null : result.error;
}

describe("compilePlugin", () => {
  test("compiles a TSX plugin to CommonJS with allowed imports only", () => {
    const result = compilePlugin(VALID, "status.tsx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain("require('@l8db/ui')");
    expect(result.code).toContain("require('react/jsx-runtime')");
    expect(result.code.split("\n").length).toBe(VALID.split("\n").length);
  });

  test("reports syntax errors with line numbers", () => {
    const error = errorOf("const a = 1;\nconst b = <div>;\n");
    expect(error?.line).toBe(2);
  });

  test.each([
    ['import x from "lodash"; x();', "lodash"],
    ['import x from "./helper"; x();', "./helper"],
    ['export * from "react-dom";', "react-dom"],
    ['import "./styles.css";', "./styles.css"],
  ])("rejects import %s", (source, name) => {
    expect(errorOf(source)?.message).toContain(`Import "${name}"`);
  });

  test("rejects dynamic imports", () => {
    expect(errorOf('const m = import("react");')?.message).toContain("Dynamische Imports");
  });

  test.each([
    "document.body.append(x);",
    "window.alert(1);",
    "globalThis.x = 1;",
    'fetch("https://evil.example");',
    'localStorage.getItem("l8db.connections");',
    "sessionStorage.clear();",
    'eval("1");',
    'const f = new Function("return 1");',
    "const r = require('react');",
    "navigator.sendBeacon('x');",
    "new WebSocket('wss://x');",
    `const x = \`\${document.cookie}\`;`,
    "const s = { a: document };",
    'const f = (a, b) => b; f(0, eval("1"));',
    "const o = { fetch() { return 2; } };",
  ])("rejects global access: %s", (source) => {
    expect(errorOf(source)?.message).toContain("nicht erlaubt");
  });

  test.each([
    "el.ownerDocument.body;",
    "ref.current.parentElement.remove();",
    'x["constructor"]("return this")();',
    "x[`constructor`];",
    "({}).constructor.constructor;",
    "Object.prototype.y = 1;",
    "x.__proto__.y = 1;",
    'const a = <div dangerouslySetInnerHTML={{ __html: "x" }} />;',
    "el.innerHTML = '<b>x</b>';",
    "React.createElement('style');",
    "node.closest('body');",
    "__TAURI_INTERNALS__.invoke('load_secret');",
    "event.view.__TAURI__.core.invoke('x');",
    'Reflect.get(view, "__TAURI_INTERNALS__");',
    "view[`__TAURI_EVENT_PLUGIN_INTERNALS__`];",
  ])("rejects escape property: %s", (source) => {
    expect(errorOf(source)?.message).toContain("nicht erlaubt");
  });

  test.each(["style", "script", "iframe", "link", "object"])("rejects <%s> elements", (tag) => {
    const error = errorOf(`const a = 1;\nconst b = <${tag}>{"x"}</${tag}>;\n`);
    expect(error?.message).toContain(`<${tag}>`);
    expect(error?.line).toBe(2);
  });

  test("rejects unicode escapes in identifiers", () => {
    expect(errorOf("\\u0064ocument.body;")?.message).toContain("Unicode-Escapes");
  });

  test.each([
    'const a = "document.body";',
    "const a = <span>document window fetch</span>;",
    "// document.body\nconst a = 1;",
    "/* window */ const a = 1;",
    "const ok = /document|window/.test(String(x));",
    "const r = row.location + row.history + row.document + row.window;",
    "const o = { location: 1, fetch: 2, window: 3 };",
    "const top = 1; const parent = 2; const self = 3;",
    "const v = a?.document;",
    `const s = \`\${row.name} lebt in \${row.city}\`;`,
    "const t = x / 2 / y;",
    "const u = (a) / (b);",
  ])("accepts harmless code: %s", (source) => {
    expect(errorOf(source)).toBeNull();
  });

  test("handles .ts files with angle-bracket assertions", () => {
    expect(errorOf("const x = <number>(1 as unknown);", "plain.ts")).toBeNull();
  });

  test("limits the source size", () => {
    expect(errorOf(`const a = "${"x".repeat(300 * 1024)}";`)?.message).toContain("256 KB");
  });
});

describe("validatePlugin", () => {
  test("normalizes a complete definition", () => {
    const plugin = validatePlugin({
      id: "acme.invoice",
      name: "Rechnung",
      permissions: { http: ["https://Billing.Example.com/api", "*.example.org:8443"] },
      options: {
        colorful: { type: "boolean", label: "Bunt", default: true },
        mode: {
          type: "select",
          label: "Modus",
          choices: ["a", { value: "b", label: "B" }],
          default: "b",
        },
        limit: { type: "number", label: "Limit", min: 1, max: 10 },
      },
      slots: { grid: { cell: () => undefined }, split: { options: { autoSaveGroups: false } } },
    });
    expect(plugin.http).toEqual(["billing.example.com/api", "*.example.org:8443"]);
    expect(plugin.name).toBe("Rechnung");
    expect(resolveOptions(plugin.options, { colorful: false, mode: "zzz", limit: 99 })).toEqual({
      colorful: false,
      mode: "b",
      limit: 10,
    });
    expect(resolveOptions(plugin.options, undefined)).toEqual({
      colorful: true,
      mode: "b",
      limit: 1,
    });
  });

  test.each([
    [{ slots: {} }, "id fehlt"],
    [{ id: "Bad Id", slots: {} }, "herausgeber.name"],
    [{ id: "a.b", slot: {} }, 'Unbekanntes Feld "slot"'],
    [{ id: "a.b", slots: { grids: {} } }, 'Unbekannte Slot-Gruppe "grids"'],
    [{ id: "a.b", slots: { grid: { cells: () => 1 } } }, 'Unbekannter Slot "grid.cells"'],
    [{ id: "a.b", slots: { grid: { cell: 1 } } }, "muss eine Funktion sein"],
    [{ id: "a.b", slots: { tabs: { options: { closeButton: "maybe" } } } }, "closeButton"],
    [
      { id: "a.b", permissions: { http: ["http://x.example"] }, slots: {} },
      "kein gültiges HTTPS-Ziel",
    ],
    [{ id: "a.b", options: { x: { type: "color", label: "X" } }, slots: {} }, "options.x.type"],
    [
      {
        id: "a.b",
        slots: {
          split: {
            templates: [
              { id: "t", name: "T", panes: [{ table: "a.b", master: 0 }, { table: "a.c" }] },
            ],
          },
        },
      },
      "früheren Bereichs",
    ],
    [
      {
        id: "a.b",
        slots: {
          split: {
            templates: [{ id: "t", name: "T", panes: [{ table: "orders" }, { table: "a.c" }] }],
          },
        },
      },
      "schema.tabelle",
    ],
    [
      {
        id: "a.b",
        slots: { split: { templates: [{ id: "t", name: "T", panes: [{ table: "a.b" }] }] } },
      },
      "2 bis 4",
    ],
    [
      {
        id: "a.b",
        slots: {
          split: {
            templates: [
              {
                id: "t",
                name: "T",
                panes: [{ table: "a.b" }, { table: "a.c", link: { column: "x" } }],
              },
            ],
          },
        },
      },
      "link braucht master",
    ],
  ])("rejects invalid definitions %#", (definition, message) => {
    expect(() => validatePlugin(definition)).toThrow(message);
  });

  test("accepts slot factories and validates them later", () => {
    const plugin = validatePlugin({ id: "a.b", slots: () => ({ grid: {} }) });
    expect(typeof plugin.slots).toBe("function");
    expect(() => validateSlots({ grid: { rowTone: "red" } })).toThrow("grid.rowTone");
  });

  test("validates column patches returned at runtime", () => {
    expect(validateColumnPatches([{ id: "a", pinned: true, width: 120 }])[0]).toMatchObject({
      id: "a",
      pinned: true,
      width: 120,
    });
    expect(() => validateColumnPatches([{ id: "a", width: 5000 }])).toThrow("width");
    expect(() => validateColumnPatches({})).toThrow("Liste");
  });
});

describe("http patterns", () => {
  test.each([
    ["billing.example.com", "https://billing.example.com/api/invoice", true],
    ["billing.example.com/api", "https://billing.example.com/api/invoice", true],
    ["billing.example.com/api", "https://billing.example.com/apix", false],
    ["billing.example.com", "http://billing.example.com/", false],
    ["billing.example.com", "https://evil.example.com/", false],
    ["*.example.com", "https://a.b.example.com/x", true],
    ["*.example.com", "https://example.com/x", false],
    ["api.example.com:8443", "https://api.example.com:8443/x", true],
    ["api.example.com", "https://api.example.com:8443/x", false],
    ["billing.example.com", "https://user:pw@billing.example.com/", false],
    [
      "api.github.com/repos/Leon-Achteresch",
      "https://api.github.com/repos/Leon-Achteresch/l8db",
      true,
    ],
    ["API.example.com/v1", "https://api.example.com/v1/x", true],
    ["api.example.com/allowed", "https://api.example.com/allowed/..%2fadmin", false],
    ["api.example.com/allowed", "https://api.example.com/allowed/%2E%2E/admin", false],
  ])("%s allows %s: %s", (pattern, url, allowed) => {
    expect(httpPatternMatches(pattern, url)).toBe(allowed);
  });

  test("parses only https patterns", () => {
    expect(parseHttpPattern("ftp://x.example")).toBeNull();
    expect(parseHttpPattern("https://x.example/a?b")).toBeNull();
  });
});

describe("catalog", () => {
  const entry = {
    id: "l8db.status-pills",
    name: "Status als Pills",
    description: "x",
    version: "1.0.0",
    author: "l8db",
    file: "plugins/status-pills/plugin.tsx",
    sha256: "a".repeat(64),
    screenshot: "plugins/status-pills/screenshot.png",
    tags: ["grid"],
    http: [],
  };

  test("accepts a valid catalog", () => {
    expect(validateCatalog({ schemaVersion: 1, plugins: [entry] }).plugins[0].id).toBe(entry.id);
  });

  test.each([
    [{ ...entry, sha256: "x" }, "sha256"],
    [{ ...entry, file: "../evil.tsx" }, "file"],
    [{ ...entry, file: "plugins/a/screenshot.png" }, "file"],
    [{ ...entry, screenshot: "plugins/a/plugin.tsx" }, "screenshot"],
    [{ ...entry, http: ["http://x"] }, "http"],
  ])("rejects invalid entries %#", (bad, field) => {
    expect(() => validateCatalog({ schemaVersion: 1, plugins: [bad] })).toThrow(field);
  });

  test("rejects duplicate ids", () => {
    expect(() => validateCatalog({ schemaVersion: 1, plugins: [entry, entry] })).toThrow("doppelt");
  });

  test("resolves files inside the catalog directory only", () => {
    const url = "https://raw.githubusercontent.com/o/r/catalog/catalog.json";
    expect(catalogFileUrl(url, "plugins/a/plugin.tsx")).toBe(
      "https://raw.githubusercontent.com/o/r/catalog/plugins/a/plugin.tsx",
    );
    expect(() => catalogFileUrl(url, "../main/x.tsx")).toThrow();
    expect(() => catalogFileUrl(url, "https://evil.example/x.tsx")).toThrow();
  });
});
