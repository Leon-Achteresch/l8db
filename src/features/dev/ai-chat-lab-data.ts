import type { AiEvent, AiMessage } from "@/lib/db/ai";

const now = Date.now();
const revenue =
  "monat\tumsatz\n2026-05\t48210\n2026-06\t51980\n2026-07\t60340\n2026-08\t55120\n2026-09\t57800\n2026-10\t56930\n(6 rows)";
const regions =
  "region\tkunden\tumsatz\nNord\t1204\t118400\nSüd\t982\t96120\nWest\t744\t70310\nOst\t512\t45020\n(4 rows)";
const answer =
  "Der Umsatz ist seit Mai um **18 %** gestiegen. Der Juli war mit 60.340 € der stärkste Monat, seitdem pendelt er sich bei rund 56.000 € ein.\n\n";
const followups =
  "```followups\n- Welche Produkte treiben das Wachstum?\n- Vergleich mit dem Vorjahr\n- Umsatz nach Region\n```";

export const LAB_QUESTION: AiMessage = {
  id: "u1",
  role: "user",
  text: "Wie hat sich der Umsatz in den letzten 6 Monaten entwickelt?",
  createdAt: now - 60_000,
};

export const LAB_DONE: AiMessage = {
  id: "a1",
  parentId: "u1",
  role: "assistant",
  createdAt: now - 58_000,
  durationMs: 8400,
  reasoning:
    "Ich suche zuerst die Bestelltabelle und prüfe, welche Spalte das Bestelldatum enthält.\nDanach summiere ich pro Monat.",
  text: `${answer}${followups}`,
  rich: [
    {
      type: "tool",
      id: "t1",
      name: "search",
      status: "success",
      output: "orders, order_items",
      at: 0,
    },
    {
      type: "tool",
      id: "t2",
      name: "query",
      status: "success",
      sql: "SELECT date_trunc('month', created_at) AS monat, sum(total) AS umsatz\nFROM orders\nWHERE created_at >= now() - interval '6 months'\nGROUP BY 1 ORDER BY 1;",
      output: revenue,
      at: 0,
    },
    {
      type: "tool",
      id: "t3",
      name: "visualize",
      status: "success",
      title: "Umsatz pro Monat",
      sql: "SELECT date_trunc('month', created_at) AS monat, sum(total) AS umsatz FROM orders GROUP BY 1;",
      output: revenue,
      chart: { chart: "line", x: "monat", y: ["umsatz"] },
      at: answer.length,
    },
  ],
};

export const LAB_TABLE: AiMessage = {
  id: "a2",
  parentId: "u2",
  role: "assistant",
  createdAt: now - 20_000,
  durationMs: 3100,
  text: "Der Norden liegt vorn, gefolgt vom Süden.",
  rich: [
    {
      type: "tool",
      id: "t4",
      name: "visualize",
      status: "success",
      title: "Kunden und Umsatz nach Region",
      sql: "SELECT region, count(*) AS kunden, sum(total) AS umsatz FROM customers GROUP BY 1;",
      output: regions,
      chart: { chart: "table" },
      at: 41,
    },
  ],
};

export const LAB_FOLLOWUP: AiMessage = {
  id: "u2",
  parentId: "a1",
  role: "user",
  text: "Und nach Region?",
  createdAt: now - 22_000,
  contextLabels: ["@public.customers"],
};

export const LAB_RUNNING: AiMessage = {
  id: "a3",
  parentId: "u3",
  role: "assistant",
  createdAt: now - 6_000,
  reasoning: "Ich prüfe, welche Bestellungen keinen Kunden haben.",
  text: "Ich habe 42 Bestellungen ohne gültigen Kunden gefunden. Ich prüfe jetzt",
  rich: [
    {
      type: "plan",
      id: "p1",
      items: [
        { id: "1", title: "Verwaiste Bestellungen finden", status: "completed" },
        { id: "2", title: "Ursache eingrenzen", status: "in-progress" },
        { id: "3", title: "Bereinigung vorschlagen", status: "pending" },
      ],
      at: 0,
    },
    { type: "tool", id: "t5", name: "query", status: "success", output: "42", at: 0 },
    { type: "tool", id: "t6", name: "drilldown", status: "running", output: "", at: 999 },
  ],
};

export const LAB_RUN_QUESTION: AiMessage = {
  id: "u3",
  role: "user",
  text: "Finde Bestellungen ohne Kunden und schlag eine Bereinigung vor.",
  createdAt: now - 7_000,
};

export const LAB_THINKING: AiMessage = {
  id: "a4",
  parentId: "u4",
  role: "assistant",
  createdAt: now - 2_000,
  text: "",
};

export const LAB_DECISIONS: AiMessage = {
  id: "a5",
  parentId: "u5",
  role: "assistant",
  createdAt: now - 90_000,
  durationMs: 12_600,
  text: "Erledigt. 42 verwaiste Bestellungen wurden archiviert.",
  rich: [
    {
      type: "tool",
      id: "t7",
      name: "execute",
      status: "success",
      output: "42 rows affected",
      at: 0,
    },
    {
      type: "decision",
      id: "d1",
      title: "Bestellungen archivieren",
      outcome: "allowed",
      at: 0,
    },
    { type: "decision", id: "d2", title: "Kunden löschen", outcome: "denied", at: 0 },
  ],
};

export const LAB_ERROR: AiMessage = {
  id: "a6",
  parentId: "u6",
  role: "assistant",
  createdAt: now - 30_000,
  durationMs: 2100,
  text: "",
  error: 'Verbindung zu shop-prod abgelehnt: password authentication failed for user "report".',
};

export const LAB_STOPPED: AiMessage = {
  id: "a7",
  parentId: "u7",
  role: "assistant",
  createdAt: now - 40_000,
  durationMs: 4300,
  stopped: true,
  text: "Ich beginne mit der Analyse der",
  rich: [{ type: "tool", id: "t8", name: "query", status: "running", output: "", at: 0 }],
};

export const LAB_APPROVAL: AiEvent = {
  kind: "approval",
  data: {
    id: "ap1",
    title: "Bestellungen archivieren",
    name: "execute",
    details: {
      tool: "execute",
      connection: "shop-prod",
      sql: "UPDATE orders SET archived = true\nWHERE customer_id IS NULL;",
      impact: "42 Zeilen in orders werden geändert.",
    },
  },
};

export const LAB_QUESTIONS: AiEvent = {
  kind: "input",
  data: {
    id: "q1",
    title: "Rückfrage",
    details: {
      questions: [
        {
          id: "scope",
          question: "Welche Bestellungen soll ich archivieren?",
          options: [
            { label: "Nur ohne Kunden", description: "42 Bestellungen" },
            { label: "Auch stornierte", description: "128 Bestellungen" },
            { label: "Alle älter als 2 Jahre", description: "3.410 Bestellungen" },
          ],
        },
        {
          id: "backup",
          question: "Vorher eine Sicherung anlegen?",
          options: [{ label: "Ja" }, { label: "Nein" }],
        },
      ],
    },
  },
};

export const LAB_MULTI: AiEvent = {
  kind: "input",
  data: {
    id: "q2",
    title: "Rückfrage",
    details: {
      questions: [
        {
          id: "columns",
          question: "Welche Spalten gehören in den Export?",
          multiSelect: true,
          options: ["id", "kunde", "summe", "status"],
        },
      ],
    },
  },
};

export const LAB_FORM: AiEvent = {
  kind: "input",
  data: {
    id: "f1",
    title: "Angaben für den Bericht",
    details: {
      message: "Für welchen Zeitraum und in welchem Format?",
      requestedSchema: {
        type: "object",
        required: ["zeitraum"],
        properties: {
          zeitraum: { type: "string", title: "Zeitraum", enum: ["Monat", "Quartal", "Jahr"] },
          format: { type: "string", title: "Format", default: "Excel" },
        },
      },
    },
  },
};

export const LAB_ISSUE = {
  title: "Ergebnis bleibt nach Aktualisieren leer",
  body: "### Beschreibung\nNach dem Aktualisieren bleibt das Ergebnis leer.\n\n### Schritte\n1. Abfrage ausführen\n2. Aktualisieren",
};
