import type { AiRichBlock } from "@/lib/ai/rich";

type Tool = Extract<AiRichBlock, { type: "tool" }>;

const now = Date.now();
const revenue =
  "monat\tumsatz\n2026-05\t48210\n2026-06\t51980\n2026-07\t60340\n2026-08\t55120\n2026-09\t57800\n2026-10\t56930\n(6 rows)";
const regions =
  "region\tkunden\tumsatz\nNord\t1204\t118400\nSüd\t982\t96120\nWest\t744\t70310\nOst\t512\t45020\n(4 rows)";
const sql = "SELECT id, customer_id, total\nFROM orders\nWHERE customer_id IS NULL\nLIMIT 50;";
const orders = "id\tcustomer_id\ttotal\n1042\t\t89.90\n1077\t\t12.50\n1103\t\t240.00\n(3 rows)";

const OUTPUTS: Record<string, string> = {
  search: "public.orders (Tabelle)\npublic.order_items (Tabelle)\npublic.v_revenue (View)",
  describe: "orders: id bigint, customer_id bigint, total numeric, created_at timestamptz",
  overview: "3 Schemas · 48 Tabellen · 12 Views · 9 Funktionen",
  connections: "Produktion (PostgreSQL)\nStaging (PostgreSQL)\nAnalytics (ClickHouse)",
  code: "Funktion refresh_revenue() liest orders und schreibt revenue_daily.",
  execute: "UPDATE 42",
  drilldown: "42 Bestellungen ohne Kunde, alle vom Import am 2026-10-14.",
  benchmark: "Median 12 ms · p95 31 ms · 50 Läufe",
  sandbox: "Probelauf ohne Fehler, 42 Zeilen wären betroffen.",
  rules: "3 Regeln geprüft, 1 verletzt: total >= 0",
  knowledge: "2 Begriffe und 1 Regel gespeichert.",
  import_file: "kunden.csv · 1.204 Zeilen importiert",
  workflow: "Workflow „Nächtlicher Export“ angelegt.",
  dashboard: "Dashboard „Umsatz“ um 2 Diagramme ergänzt.",
  editor: "SQL in neuen Editor-Tab übernommen.",
  notebook: "Notebook „Analyse Oktober“ mit 4 Zellen erstellt.",
  app_search: "Hilfe: Verbindung über SSH-Tunnel einrichten",
  app_execute: "Einstellungen › Darstellung geöffnet.",
  chat_title: "Verwaiste Bestellungen",
  mcp__github__list_issues: "#412 Umsatzbericht zeigt Juli doppelt\n#409 Export bricht ab",
  bash: "psql 18.1",
};

export const PART_TOOLS: Tool[] = Object.keys(OUTPUTS).map((name, index) => ({
  type: "tool",
  id: `tool-${name}`,
  name,
  status: "success",
  output: OUTPUTS[name],
  start: now - 60_000,
  end: now - 60_000 + 400 + index * 180,
}));

export const PART_QUERY_RUNNING: Tool = {
  type: "tool",
  id: "q-running",
  name: "query",
  status: "running",
  sql,
  output: "",
  start: now - 4_000,
};

export const PART_QUERY_STATES: Tool[] = [
  {
    type: "tool",
    id: "q-success",
    name: "query",
    status: "success",
    sql,
    output: orders,
    start: now - 9_000,
    end: now - 7_600,
  },
  {
    type: "tool",
    id: "q-text",
    name: "query",
    status: "success",
    output: "42",
    start: now - 7_000,
    end: now - 6_900,
  },
  {
    type: "tool",
    id: "q-error",
    name: "query",
    status: "error",
    sql: "SELECT * FROM order;",
    output: 'ERROR: relation "order" does not exist\nHINT: Meintest du "orders"?',
    start: now - 6_000,
    end: now - 5_700,
  },
  {
    type: "tool",
    id: "q-cancelled",
    name: "query",
    status: "running",
    sql,
    output: "",
    start: now - 5_000,
  },
];

export const PART_DECISIONS: AiRichBlock[] = [
  { type: "decision", id: "d1", title: "42 Bestellungen löschen", outcome: "allowed" },
  { type: "decision", id: "d2", title: "Tabelle orders_tmp entfernen", outcome: "denied" },
  { type: "decision", id: "d3", title: "Welcher Zeitraum?", outcome: "answered" },
];

export const PART_PLAN: AiRichBlock = {
  type: "plan",
  id: "plan",
  items: [
    { id: "1", title: "Verwaiste Bestellungen finden", status: "completed" },
    { id: "2", title: "Ursache eingrenzen", status: "in-progress" },
    { id: "3", title: "Bereinigung vorschlagen", status: "pending" },
    { id: "4", title: "Archiv-Tabelle anlegen", status: "cancelled" },
  ],
};

export const PART_DIFF: AiRichBlock = {
  type: "diff",
  id: "diff",
  path: "queries/revenue.sql",
  diff: "@@ -1,3 +1,4 @@\n SELECT date_trunc('month', created_at) AS monat,\n-       sum(total)\n+       sum(total) AS umsatz\n FROM orders\n+WHERE deleted_at IS NULL",
};

export const PART_IMAGES: AiRichBlock[] = [
  { type: "image", id: "img-1", label: "ER-Diagramm", status: "generating" },
  { type: "image", id: "img-2", label: "ER-Diagramm", status: "complete" },
  { type: "image", id: "img-3", label: "ER-Diagramm", status: "error" },
];

const issue = (id: string, status: string, output: string): Tool => ({
  type: "tool",
  id,
  name: "report_issue",
  status,
  title: "Umsatzbericht zeigt Juli doppelt",
  body: "Im Diagramm „Umsatz pro Monat“ erscheint der Juli zweimal.",
  output,
});

export const PART_ISSUES: Tool[] = [
  issue("issue-running", "running", ""),
  issue("issue-success", "success", "https://github.com/Leon-Achteresch/l8db/issues/412"),
  issue("issue-error", "error", "Dienst nicht erreichbar."),
];

const chart = (kind: string, output: string, x?: string, y?: string[]): Tool => ({
  type: "tool",
  id: `chart-${kind}`,
  name: "visualize",
  status: "success",
  title: `Diagramm · ${kind}`,
  sql: "SELECT …",
  output,
  chart: { chart: kind, ...(x ? { x } : {}), ...(y ? { y } : {}) },
});

export const PART_CHARTS: Tool[] = [
  chart("line", revenue, "monat", ["umsatz"]),
  chart("area", revenue, "monat", ["umsatz"]),
  chart("column", revenue, "monat", ["umsatz"]),
  chart("bars", regions, "region", ["umsatz"]),
  chart("donut", regions, "region", ["kunden"]),
  chart("scatter", regions, "kunden", ["umsatz"]),
  chart("kpi", "umsatz\n348380\n(1 rows)"),
  chart("table", regions),
];

export const PART_REASONING =
  "Ich suche zuerst die Bestelltabelle und prüfe, welche Spalte das Bestelldatum enthält.\nDanach summiere ich pro Monat und vergleiche mit dem Vorjahr.";
