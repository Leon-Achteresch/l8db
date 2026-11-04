import type { ChatContextItem } from "@/lib/ai/chat-context";
import type { AiTable } from "@/lib/ai/result";
import type { McpAuditEntry } from "@/lib/mcp";

export const AI_LAB_SCENES = [
  { id: "start", title: "Einstieg", description: "Mit einer klaren Frage anfangen." },
  { id: "running", title: "Analyse", description: "Arbeitsschritte statt Werkzeugrauschen." },
  { id: "results", title: "Ergebnisse", description: "Antwort und Daten nebeneinander." },
  { id: "editor", title: "SQL-Editor", description: "Änderungen prüfen und übernehmen." },
  { id: "approval", title: "Freigabe", description: "Auswirkungen vor der Entscheidung." },
  { id: "context", title: "Kontext", description: "Daten und Werkzeuge bewusst auswählen." },
  { id: "settings", title: "Einrichtung", description: "Anbieter, Modell und Verlauf." },
  { id: "mcp", title: "MCP", description: "Zugriff und Erreichbarkeit unterscheiden." },
] as const;

export type AiLabScene = (typeof AI_LAB_SCENES)[number]["id"];
export const AI_LAB_MESSAGE_LIMIT = 12;

export interface AiLabMessage {
  id: string;
  text: string;
}

export function appendAiLabMessage(messages: AiLabMessage[], text: string): AiLabMessage[] {
  return [
    ...messages.slice(-(AI_LAB_MESSAGE_LIMIT - 1)),
    { id: crypto.randomUUID(), text: text.slice(0, 2000) },
  ];
}

export const AI_LAB_CONTEXT: ChatContextItem[] = [
  { id: "orders", kind: "table", label: "orders", schema: "public", table: "orders" },
  { id: "customers", kind: "table", label: "customers", schema: "public", table: "customers" },
  { id: "editor", kind: "tab", label: "Editor: kunden.sql" },
];

export const AI_LAB_SQL = `SELECT c.id, c.name, SUM(o.total) AS revenue
FROM public.customers c
JOIN public.orders o ON o.customer_id = c.id
WHERE o.created_at >= '2026-10-01'
  AND o.created_at < '2026-10-02'
GROUP BY c.id, c.name;`;

export const AI_LAB_TABLE: AiTable = {
  columns: ["Kundengruppe", "September", "Oktober"],
  rows: [
    { Kundengruppe: "Geschäftskunden", September: "260000", Oktober: "161000" },
    { Kundengruppe: "Privatkunden", September: "278000", Oktober: "278000" },
  ],
  footer: "2 rows",
};

export const AI_LAB_AUDIT: McpAuditEntry[] = [
  {
    ts: "2026-11-04T10:42:00Z",
    connection: "Shop",
    tool: "query",
    sql: "SELECT customer_group, SUM(total) FROM orders GROUP BY customer_group",
    ok: true,
    ms: 84,
  },
  {
    ts: "2026-11-04T10:41:00Z",
    connection: "Analytics",
    tool: "describe",
    sql: "main.revenue",
    ok: true,
    ms: 32,
  },
  {
    ts: "2026-11-04T10:40:00Z",
    connection: "Tickets",
    tool: "search",
    sql: "Umsatz Oktober",
    ok: false,
    ms: 30000,
    error: "Server nicht erreichbar · Beispiel",
  },
];
