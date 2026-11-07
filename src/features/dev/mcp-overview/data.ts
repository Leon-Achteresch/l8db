import type { DatabaseKind } from "@/lib/db";

export interface LabDatabase {
  id: string;
  name: string;
  kind: DatabaseKind;
  group: string;
  exposed: boolean;
  readOnly: boolean;
  allowDdl: boolean;
  allowScripts: boolean;
  allowProductionWrites: boolean;
  environment: string | null;
  schemas: string[];
  maskedColumns: string[];
}

export interface LabClient {
  id: string;
  name: string;
  registered: boolean;
}

export interface LabCall {
  id: number;
  ts: number;
  connection: string;
  tool: string;
  ok: boolean;
  ms: number;
  params: Record<string, unknown>;
  response: string;
}

export interface LabLimits {
  maxRows: number;
  maxCellChars: number;
  maxChars: number;
  queryTimeout: number;
}

export interface McpLabState {
  enabled: boolean;
  databases: LabDatabase[];
  clients: LabClient[];
  calls: LabCall[];
  maskRules: number;
  limits: LabLimits;
  workflows: boolean;
}

export interface McpVariantProps {
  state: McpLabState;
  onToggleServer: () => void;
  onToggleDatabase: (id: string) => void;
}

const NOW = Date.UTC(2026, 10, 5, 14, 0);

function db(
  id: string,
  name: string,
  kind: DatabaseKind,
  group: string,
  patch: Partial<LabDatabase> = {},
): LabDatabase {
  return {
    id,
    name,
    kind,
    group,
    exposed: false,
    readOnly: true,
    allowDdl: false,
    allowScripts: false,
    allowProductionWrites: false,
    environment: null,
    schemas: [],
    maskedColumns: [],
    ...patch,
  };
}

const TENANTS = [
  "Nordwind",
  "Aurora",
  "Kestrel",
  "Lumen",
  "Brightfield",
  "Halcyon",
  "Meridian",
  "Quarz",
  "Sable",
  "Tamarisk",
  "Vireo",
  "Zephyr",
];
const KINDS: DatabaseKind[] = ["postgres", "mysql", "mssql", "oracle"];
const ENVS = [
  { id: "production", label: "Prod" },
  { id: "staging", label: "Test" },
];
const GROUPS = ["A–F", "G–L", "M–R", "S–Z"];

export const LAB_DATABASES: LabDatabase[] = [
  db("shop", "Shop Produktion", "postgres", "Shop", {
    exposed: true,
    environment: "production",
    schemas: ["public", "billing"],
    maskedColumns: ["email", "iban"],
  }),
  db("shop-staging", "Shop Staging", "postgres", "Shop", { exposed: true, environment: "staging" }),
  db("shop-search", "Produktsuche", "elasticsearch", "Shop"),
  db("shop-cache", "Sessions", "redis", "Shop"),
  db("analytics", "Analytics", "clickhouse", "Daten", { exposed: true }),
  db("warehouse", "Warehouse", "bigquery", "Daten", { schemas: ["marts"] }),
  db("events", "Events", "mongodb", "Daten"),
  db("crm", "CRM", "mysql", "Intern", {
    environment: "production",
    maskedColumns: ["phone"],
  }),
  db("erp", "ERP", "oracle", "Intern", { environment: "production" }),
  db("hr", "Personal", "mssql", "Intern"),
  db("local", "Lokale Entwicklung", "sqlite", "Lokal", {
    exposed: true,
    readOnly: false,
    allowDdl: true,
    allowScripts: true,
    environment: "development",
  }),
  db("duck", "Exporte", "duckdb", "Lokal"),
  ...Array.from({ length: 96 }, (_, index) => {
    const tenant = TENANTS[index % TENANTS.length];
    const kind = KINDS[index % KINDS.length];
    const env = ENVS[index % ENVS.length];
    return db(
      `tenant-${index}`,
      `${tenant} ${env.label}`,
      kind,
      `Kunden ${GROUPS[index % GROUPS.length]}`,
      {
        environment: env.id,
        exposed: index % 9 === 0,
      },
    );
  }),
];

export const LAB_CLIENTS: LabClient[] = [
  { id: "claude-code", name: "Claude Code", registered: true },
  { id: "cursor", name: "Cursor", registered: true },
  { id: "codex", name: "Codex", registered: false },
  { id: "vscode", name: "VS Code", registered: false },
  { id: "gemini", name: "Gemini CLI", registered: false },
];

const SAMPLES: { tool: string; params: Record<string, unknown>; response: string }[] = [
  {
    tool: "query",
    params: {
      sql: "SELECT id, email, total FROM orders WHERE created_at > now() - interval '1 day' ORDER BY total DESC",
      limit: 100,
    },
    response:
      "id\temail\ttotal\n48211\t•••••\t1290.00\n48177\t•••••\t845.50\n48302\t•••••\t612.90\n… 37 Zeilen",
  },
  {
    tool: "describe",
    params: { objects: ["public.orders", "public.customers"] },
    response:
      "public.orders\n  id bigint PK\n  customer_id bigint → customers.id\n  total numeric(10,2)\n  created_at timestamptz",
  },
  {
    tool: "search",
    params: { words: ["invoice"], kinds: ["table", "column"] },
    response:
      "table\tbilling.invoices\ncolumn\tbilling.invoices.invoice_no\ncolumn\torders.invoice_id",
  },
  {
    tool: "overview",
    params: {},
    response: "schemas\t4\ntables\t86\nlargest\tevents (2.1 GB), orders (640 MB)",
  },
  {
    tool: "explain",
    params: { sql: "SELECT * FROM events WHERE user_id = 42" },
    response: "Seq Scan on events  (cost=0.00..48211.00 rows=118)\n  Filter: (user_id = 42)",
  },
  {
    tool: "relations",
    params: { tables: ["orders", "customers"] },
    response: "orders.customer_id = customers.id",
  },
];

const CONNECTIONS = ["Shop Produktion", "Analytics", "Lokale Entwicklung", "Shop Staging"];

export const LAB_CALLS: LabCall[] = Array.from({ length: 96 }, (_, index) => {
  const seed = (index * 7919) % 101;
  const sample = SAMPLES[(seed + index) % SAMPLES.length];
  const ok = seed % 13 !== 0;
  return {
    id: index,
    ts: NOW - index * 17 * 60_000 - seed * 4_000,
    connection: CONNECTIONS[seed % CONNECTIONS.length],
    tool: sample.tool,
    ok,
    ms: 12 + ((seed * 37) % 480),
    params: sample.params,
    response: ok ? sample.response : "Fehler: canceling statement due to statement timeout",
  };
});

export const LAB_NOW = NOW;

export const LAB_LIMITS: LabLimits = {
  maxRows: 200,
  maxCellChars: 500,
  maxChars: 40_000,
  queryTimeout: 30,
};

export function formatAgo(ts: number): string {
  const minutes = Math.round((LAB_NOW - ts) / 60_000);
  if (minutes < 1) return "jetzt";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

export function callsPerHour(calls: LabCall[], hours = 24): number[] {
  const buckets = new Array<number>(hours).fill(0);
  for (const call of calls) {
    const slot = hours - 1 - Math.floor((LAB_NOW - call.ts) / 3_600_000);
    if (slot >= 0 && slot < hours) buckets[slot] += 1;
  }
  return buckets;
}
