import type { DatabaseKind } from "@/lib/db";
import type { FeatureCapability } from "../types";

export interface WaitTip {
  id: string;
  text: string;
  hotkey?: string;
  featureId?: string;
  families?: readonly DatabaseKind[];
  capability?: FeatureCapability;
}

export const WAIT_TIPS: readonly WaitTip[] = [
  { id: "cancel", text: "{hotkey} bricht die laufende Abfrage ab.", hotkey: "query.cancel" },
  {
    id: "run-statement",
    text: "{hotkey} führt nur die Anweisung unter dem Cursor aus.",
    hotkey: "query.runStatement",
  },
  {
    id: "run-selection",
    text: "{hotkey} führt nur die Markierung aus.",
    hotkey: "query.runSelection",
  },
  {
    id: "format",
    text: "{hotkey} formatiert dein SQL.",
    hotkey: "query.format",
    featureId: "query.format",
  },
  {
    id: "history",
    text: "{hotkey} öffnet den Abfrageverlauf.",
    hotkey: "query.history",
    featureId: "query.history",
  },
  {
    id: "save",
    text: "{hotkey} speichert die Abfrage für später.",
    hotkey: "query.save",
    featureId: "query.snippets",
  },
  {
    id: "palette",
    text: "{hotkey} öffnet die Befehlspalette.",
    hotkey: "palette.open",
    featureId: "search.commands",
  },
  {
    id: "quick-open",
    text: "{hotkey} öffnet Tabellen und Abfragen per Name.",
    hotkey: "palette.quickOpen",
  },
  {
    id: "ai",
    text: "{hotkey} öffnet den KI-Assistenten.",
    hotkey: "ai.toggle",
    featureId: "ai.chat",
  },
  {
    id: "split",
    text: "{hotkey} teilt die Ansicht.",
    hotkey: "view.split",
    featureId: "view.split",
  },
  {
    id: "reopen-tab",
    text: "{hotkey} öffnet den zuletzt geschlossenen Tab wieder.",
    hotkey: "tab.reopen",
  },
  {
    id: "check",
    text: "{hotkey} prüft eine Abfrage, ohne Änderungen zu behalten.",
    hotkey: "query.check",
    featureId: "query.check",
  },
  {
    id: "bookmark",
    text: "{hotkey} setzt ein Lesezeichen im Editor.",
    hotkey: "query.bookmark",
    featureId: "query.bookmark",
  },
  {
    id: "comment",
    text: "{hotkey} kommentiert die Zeile aus.",
    hotkey: "query.comment",
    capability: "sql",
  },
  { id: "grid-search", text: "{hotkey} durchsucht das Ergebnis.", hotkey: "grid.search" },
  { id: "grid-export", text: "{hotkey} exportiert das Ergebnis.", hotkey: "grid.export" },
  {
    id: "explain",
    text: "Explain zeigt, wo eine langsame Abfrage Zeit verliert.",
    featureId: "explain",
  },
  {
    id: "index-advisor",
    text: "Der Index-Advisor schlägt fehlende Indizes vor.",
    featureId: "index-advisor",
  },
  {
    id: "snapshots",
    text: "Ergebnis-Snapshots halten einen Stand zum späteren Vergleich fest.",
    featureId: "query.results.snapshots",
  },
  {
    id: "multi-target",
    text: "Eine Abfrage kann auf mehreren Verbindungen zugleich laufen.",
    featureId: "query.multi-target",
  },
  {
    id: "notebook",
    text: "SQL-Notebooks bündeln Abfragen, Ergebnisse und Notizen.",
    featureId: "notebook",
  },
  {
    id: "limit",
    text: "Ein LIMIT beim Ausprobieren spart Wartezeit.",
    capability: "sql",
  },
  {
    id: "pg-buffers",
    text: "EXPLAIN (ANALYZE, BUFFERS) zeigt auch Cache-Treffer.",
    families: ["postgres"],
  },
  {
    id: "pg-statement-timeout",
    text: "SET statement_timeout begrenzt die Laufzeit dieser Sitzung.",
    families: ["postgres"],
  },
  {
    id: "mysql-explain-analyze",
    text: "EXPLAIN ANALYZE misst echte Laufzeiten ab MySQL 8.0.18.",
    families: ["mysql"],
  },
  {
    id: "oracle-output",
    text: "DBMS_OUTPUT erscheint in der Server-Ausgabe.",
    featureId: "query.server-output",
    families: ["oracle"],
  },
  {
    id: "mssql-statistics-io",
    text: "SET STATISTICS IO ON zeigt die gelesenen Seiten.",
    families: ["mssql"],
  },
  {
    id: "sqlite-analyze",
    text: "ANALYZE sammelt Statistiken für bessere SQLite-Pläne.",
    families: ["sqlite"],
  },
  {
    id: "clickhouse-prewhere",
    text: "PREWHERE filtert in ClickHouse, bevor alle Spalten gelesen werden.",
    families: ["clickhouse"],
  },
  {
    id: "duckdb-files",
    text: "DuckDB liest CSV- und Parquet-Dateien direkt per SELECT.",
    families: ["duckdb"],
  },
];
