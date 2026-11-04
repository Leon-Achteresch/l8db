import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { QueryResult } from "@/lib/db";

const LEAD = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;

export function leadingWords(sql: string, count = 4): string[] {
  return sql
    .replace(LEAD, "")
    .split(/[\s(;]+/, count + 1)
    .filter(Boolean)
    .slice(0, count)
    .map((word) => word.toUpperCase());
}

const OBJECTS: Record<string, string> = {
  TABLE: "Tabelle",
  VIEW: "View",
  INDEX: "Index",
  SEQUENCE: "Sequence",
  SYNONYM: "Synonym",
  PROCEDURE: "Prozedur",
  FUNCTION: "Funktion",
  PACKAGE: "Paket",
  "PACKAGE BODY": "Paketrumpf",
  TRIGGER: "Trigger",
  TYPE: "Typ",
  "TYPE BODY": "Typrumpf",
  USER: "Benutzer",
  ROLE: "Rolle",
  "MATERIALIZED VIEW": "Materialized View",
  "DATABASE LINK": "Database Link",
  DIRECTORY: "Directory",
  TABLESPACE: "Tablespace",
  PROFILE: "Profil",
  CONTEXT: "Context",
  LIBRARY: "Library",
  SESSION: "Session",
  SYSTEM: "System",
  CLUSTER: "Cluster",
};

const MODIFIERS = new Set([
  "OR",
  "REPLACE",
  "EDITIONABLE",
  "NONEDITIONABLE",
  "PUBLIC",
  "PRIVATE",
  "GLOBAL",
  "TEMPORARY",
  "FORCE",
  "NOFORCE",
  "UNIQUE",
  "BITMAP",
  "SHARED",
  "IF",
  "NOT",
  "EXISTS",
  "EDITIONING",
  "NO",
  "BLOCKCHAIN",
  "IMMUTABLE",
]);

export function objectOf(words: string[]): string | null {
  const rest = words.slice(1).filter((word) => !MODIFIERS.has(word));
  const two = rest.slice(0, 2).join(" ");
  if (OBJECTS[two]) return two;
  return OBJECTS[rest[0]] ? rest[0] : null;
}

export function compileWarning(sql: string): string {
  const object = objectOf(leadingWords(sql, 8));
  return `Warnung: ${object ? OBJECTS[object] : "Objekt"} wurde mit Kompilierungsfehlern erstellt.`;
}

function rows(count: number, verb: string): string {
  if (count === 0) return `Keine Zeilen ${verb}.`;
  return `${count} ${count === 1 ? "Zeile" : "Zeilen"} ${verb}.`;
}

export function sqlplusFeedback(sql: string, result: QueryResult | undefined): string | null {
  const words = leadingWords(sql, 12);
  const first = words[0] ?? "";
  if (result?.columns.length) {
    const count = result.rows.length;
    const text = rows(count, "ausgewählt");
    return result.truncated ? `${text} (Zeilenlimit erreicht)` : text;
  }
  const affected = result?.rows_affected == null ? null : Number(result.rows_affected);
  const verbs: Record<string, string> = {
    INSERT: "eingefügt",
    UPDATE: "aktualisiert",
    DELETE: "gelöscht",
    MERGE: "zusammengeführt",
  };
  if (verbs[first] && affected !== null) return rows(affected, verbs[first]);
  if (["BEGIN", "DECLARE", "EXEC", "EXECUTE"].includes(first))
    return "PL/SQL-Prozedur erfolgreich abgeschlossen.";
  if (first === "CALL") return "Aufruf abgeschlossen.";
  if (first === "COMMIT") return "Transaktion mit COMMIT abgeschlossen.";
  if (first === "ROLLBACK")
    return words[1] === "TO" || words[2] === "TO"
      ? "Rollback zum Savepoint durchgeführt."
      : "Transaktion mit ROLLBACK zurückgesetzt.";
  if (first === "SAVEPOINT") return "Savepoint erstellt.";
  if (first === "SET" && words[1] === "TRANSACTION") return "Transaktion festgelegt.";
  if (first === "SET" && words[1] === "ROLE") return "Rolle festgelegt.";
  if (first === "TRUNCATE") return "Tabelle geleert.";
  if (first === "GRANT") return "Grant erfolgreich.";
  if (first === "REVOKE") return "Revoke erfolgreich.";
  if (first === "COMMENT") return "Kommentar erstellt.";
  if (first === "RENAME") return "Objekt umbenannt.";
  if (first === "LOCK") return "Tabelle(n) gesperrt.";
  if (first === "ANALYZE") return "Analyse abgeschlossen.";
  if (first === "PURGE") return "Papierkorb geleert.";
  if (first === "FLASHBACK") return "Flashback abgeschlossen.";
  if (first === "AUDIT" || first === "NOAUDIT") return "Audit erfolgreich.";
  const action = { CREATE: "erstellt", ALTER: "geändert", DROP: "gelöscht" }[first];
  if (action) {
    const object = objectOf(words);
    return object ? `${OBJECTS[object]} ${action}.` : `Anweisung ausgeführt.`;
  }
  if (affected !== null) return rows(affected, "verarbeitet");
  return "Anweisung ausgeführt.";
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/\r?\n/g, " ");
}

const MAX_WIDTH = 60;

export function resultTable(result: QueryResult): string[] {
  const widths = result.columns.map((column) =>
    Math.min(
      MAX_WIDTH,
      Math.max(
        column.length,
        ...result.rows.map(
          (row) => cell((row as Record<string, unknown>)[column]).slice(0, MAX_WIDTH).length,
        ),
      ),
    ),
  );
  const line = (values: string[]) =>
    values
      .map((value, index) => value.slice(0, MAX_WIDTH).padEnd(widths[index]))
      .join(" ")
      .trimEnd();
  return [
    line(result.columns),
    widths.map((width) => "-".repeat(width)).join(" "),
    ...result.rows.map((row) =>
      line(result.columns.map((column) => cell((row as Record<string, unknown>)[column]))),
    ),
  ];
}

export function entryTranscript(entry: ScriptRunEntry): string[] {
  const [head, ...rest] = entry.sql.split("\n");
  const lines = [`SQL> ${head}`, ...rest];
  for (const message of entry.output ?? []) {
    const prefix = ["OUTPUT", "PROMPT", "INFO"].includes(message.level) ? "" : `${message.level}: `;
    lines.push(...`${prefix}${message.message}`.split("\n"));
    if (message.detail) lines.push(`  ${message.detail}`);
  }
  if (entry.result?.columns.length) lines.push("", ...resultTable(entry.result), "");
  if (entry.feedback) lines.push(entry.feedback);
  if (entry.error) lines.push(`FEHLER: ${entry.error}`);
  if (entry.status === "skipped") lines.push("(nicht ausgeführt)");
  if (entry.status === "ignored") lines.push(`(ignoriert${entry.note ? `: ${entry.note}` : ""})`);
  return lines;
}

export function scriptTranscript(entries: ScriptRunEntry[]): string {
  return `${entries.map((entry) => entryTranscript(entry).join("\n")).join("\n\n")}\n`;
}
