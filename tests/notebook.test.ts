import { describe, expect, test } from "bun:test";
import { parseInline, safeHref } from "../src/lib/markdown";
import {
  applyTemplates,
  capOutputs,
  markdownToHtml,
  type NotebookCell,
  type NotebookDoc,
  type NotebookOutput,
  newNotebook,
  notebookToHtml,
  notebookToMarkdown,
  notebookVariables,
  parseNotebook,
  prepareCellSql,
  serializeNotebook,
} from "../src/lib/notebook";

const cells: NotebookCell[] = [
  { id: "t", type: "markdown", source: "# Umsatz\n\nSiehe [Doku](javascript:alert(1))" },
  {
    id: "v",
    type: "variables",
    variables: [
      { name: "region", type: "text", value: "Nord" },
      { name: "min", type: "int", value: "10" },
      { name: "tbl", type: "text", value: "orders" },
    ],
  },
  { id: "q", type: "sql", source: "select * from ${tbl} where region = :region and n > :min" },
];

const doc: NotebookDoc = { name: "Test", connectionId: "c1", saveResults: true, cells };

const output: NotebookOutput = {
  columns: ["region", "n"],
  rows: [
    { region: "<b>Nord</b>", n: 12 },
    { region: "Süd|Ost", n: 3 },
  ],
  rowsAffected: null,
  executionMs: 7,
  ranAt: 1,
};

describe("Notebook-Variablen", () => {
  test("sammelt nur Variablen oberhalb der Zelle", () => {
    expect(Object.keys(notebookVariables(cells, 2))).toEqual(["region", "min", "tbl"]);
    expect(notebookVariables(cells, 1)).toEqual({});
  });

  test("ersetzt Vorlagen und bindet Parameter", () => {
    const values = notebookVariables(cells, 2);
    const bound = prepareCellSql(cells[2].type === "sql" ? cells[2].source : "", values, {
      bindParams: true,
      sqlLanguage: true,
      kind: "postgres",
    });
    expect(bound.sql).toBe("select * from orders where region = :region and n > :min");
    expect(bound.bound?.sql).toBe(
      "select * from orders where region = $1::text and n > $2::bigint",
    );
    expect(bound.bound?.values).toEqual(["Nord", "10"]);
    const inline = prepareCellSql("select :region, :min", values, {
      bindParams: false,
      sqlLanguage: true,
    });
    expect(inline.sql).toBe("select 'Nord', 10");
  });

  test("meldet fehlende Variablen", () => {
    expect(() => applyTemplates("select ${nope}", {})).toThrow("nope");
    expect(() =>
      prepareCellSql("select :missing", {}, { bindParams: true, sqlLanguage: true }),
    ).toThrow("missing");
    expect(
      prepareCellSql("db.users.find({})", {}, { bindParams: false, sqlLanguage: false }).sql,
    ).toBe("db.users.find({})");
  });
});

describe("Notebook-Datei", () => {
  test("Rundreise mit gespeicherten Ergebnissen", () => {
    const text = serializeNotebook(doc, { q: output, gone: output });
    const parsed = parseNotebook(text);
    expect(parsed.doc.cells).toEqual(cells);
    expect(parsed.doc.saveResults).toBe(true);
    expect(Object.keys(parsed.outputs)).toEqual(["q"]);
    expect(parsed.outputs.q.totalRows).toBe(2);
  });

  test("ohne Ergebnis-Schalter werden keine Ergebnisse gespeichert", () => {
    const parsed = parseNotebook(serializeNotebook({ ...doc, saveResults: false }, { q: output }));
    expect(parsed.outputs).toEqual({});
  });

  test("kappt Zeilen und Gesamtgröße", () => {
    const big = { ...output, rows: Array.from({ length: 50 }, (_, n) => ({ region: "x", n })) };
    expect(capOutputs({ q: big }, cells, 5).q.rows).toHaveLength(5);
    expect(capOutputs({ q: big }, cells, 5).q.totalRows).toBe(50);
    expect(capOutputs({ q: big }, cells, 50, 100)).toEqual({});
  });

  test("lehnt ungültige Dateien ab", () => {
    expect(() => parseNotebook("{}")).toThrow("kein gültiges");
    expect(() =>
      parseNotebook(
        JSON.stringify({ format: "l8db-notebook", version: 1, cells: [{ id: "x", type: "html" }] }),
      ),
    ).toThrow();
    expect(newNotebook("c").cells.map((c) => c.type)).toEqual(["markdown", "sql"]);
  });
});

describe("Notebook-Export", () => {
  test("Markdown enthält SQL und Ergebnistabelle", () => {
    const md = notebookToMarkdown(doc, { q: output });
    expect(md).toContain("```sql\nselect * from ${tbl}");
    expect(md).toContain("| region | n |");
    expect(md).toContain("Süd\\|Ost");
    expect(md).toContain("_2 Zeilen · 7 ms_");
  });

  test("HTML maskiert Inhalte und entfernt unsichere Links", () => {
    const html = notebookToHtml(doc, { q: { ...output, error: undefined } });
    expect(html).toContain("&lt;b&gt;Nord&lt;/b&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<h1>Umsatz</h1>");
    expect(markdownToHtml("[x](https://l8db.dev)")).toBe('<p><a href="https://l8db.dev">x</a></p>');
  });

  test("safeHref erlaubt nur sichere Ziele", () => {
    expect(safeHref("https://a.b")).toBe("https://a.b");
    expect(safeHref(" javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(parseInline("[a](javascript:x)")[0]).toMatchObject({ t: "link" });
  });
});
