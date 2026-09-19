import { identifierStyleForKind } from "@/lib/export";
import { KIND_LABEL, migrationTransactional, STATEMENT_ORDER } from "./sql";
import { statementsForEntry } from "./statements";
import type {
  MigrationIssue,
  MigrationScript,
  MigrationScriptInput,
  MigrationStatement,
} from "./types";

function commentLines(text: string): string[] {
  return text.split("\n").map((line) => `-- ${line}`);
}

function renderScript(
  script: Omit<MigrationScript, "sql">,
  input: MigrationScriptInput,
  generatedAt: Date,
): string {
  const scope = input.base.scope;
  const lines: string[] = [
    ...commentLines("Migrationsskript (erzeugt aus Metadaten-Snapshot-Vergleich)"),
    ...commentLines(
      `Von Snapshot ${input.base.captured_at} nach Stand ${input.current.captured_at}`,
    ),
    ...commentLines(
      `Umfang: ${scope.connection_name} · ${scope.database ?? "—"} · Schema ${scope.schema}`,
    ),
    ...commentLines(`Erzeugt: ${generatedAt.toISOString()}`),
    ...commentLines(
      `Anweisungen: ${script.statements.length} · gefährlich: ${script.dangerousCount}`,
    ),
  ];
  if (script.skippedDangerous > 0) {
    lines.push(
      ...commentLines(
        `${script.skippedDangerous} gefährliche Anweisungen wurden auf Wunsch ausgelassen.`,
      ),
    );
  }
  if (!script.transactional) {
    lines.push(
      ...commentLines(
        "Diese Datenbank kennt kein transaktionales DDL; die Klammer BEGIN/COMMIT entfällt.",
      ),
    );
  }
  lines.push("");

  if (script.transactional) {
    lines.push("BEGIN;", "");
  }

  script.statements.forEach((statement, index) => {
    lines.push(
      `-- ${index + 1}. ${KIND_LABEL[statement.kind]}: ${statement.table}${statement.column ? `.${statement.column}` : ""}`,
    );
    if (statement.dangerous) {
      lines.push(`-- ACHTUNG (gefährlich): ${statement.note ?? "Prüfen vor dem Ausführen."}`);
    } else if (statement.note) {
      lines.push(`-- Hinweis: ${statement.note}`);
    }
    lines.push(statement.sql, "");
  });

  if (script.statements.length === 0) {
    lines.push(...commentLines("Keine abbildbaren Unterschiede gefunden."), "");
  }

  if (script.transactional) {
    lines.push("COMMIT;", "");
  }

  if (script.issues.length > 0) {
    lines.push(...commentLines("Nicht abbildbare Unterschiede:"));
    for (const issue of script.issues) {
      lines.push(
        ...commentLines(
          `  ${issue.table}${issue.column ? `.${issue.column}` : ""}: ${issue.detail}`,
        ),
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildMigrationScript(input: MigrationScriptInput): MigrationScript {
  const style = identifierStyleForKind(input.kind);
  const includeDangerous = input.includeDangerous ?? true;
  const generatedAt = input.generatedAt ?? new Date();
  const issues: MigrationIssue[] = [];

  for (const table of [...input.base.tables, ...input.current.tables]) {
    if (table.incomplete_reason !== null) {
      issues.push({
        table: `${table.schema}.${table.name}`,
        column: null,
        detail: `Metadaten unvollständig: ${table.incomplete_reason}`,
      });
    }
  }

  const collected: Omit<MigrationStatement, "id">[] = [];
  for (const entry of input.entries) {
    collected.push(...statementsForEntry(entry, input, style, issues));
  }

  const ordered = collected
    .map((statement, index) => ({ statement, index }))
    .sort(
      (a, b) =>
        STATEMENT_ORDER[a.statement.kind] - STATEMENT_ORDER[b.statement.kind] ||
        a.statement.table.localeCompare(b.statement.table) ||
        a.index - b.index,
    )
    .map(({ statement }, position) => ({
      ...statement,
      id: `${position + 1}-${statement.kind}-${statement.table}${statement.column ? `.${statement.column}` : ""}`,
    }));

  const dangerousCount = ordered.filter((statement) => statement.dangerous).length;
  const statements = includeDangerous
    ? ordered
    : ordered.filter((statement) => !statement.dangerous);

  const partial: Omit<MigrationScript, "sql"> = {
    statements,
    issues,
    transactional: migrationTransactional(input.kind),
    dangerousCount: includeDangerous ? dangerousCount : 0,
    skippedDangerous: includeDangerous ? 0 : dangerousCount,
  };

  return { ...partial, sql: renderScript(partial, input, generatedAt) };
}

export function migrationFileName(schema: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "-").replace(/Z$/, "");
  const safeSchema = schema.replace(/[^A-Za-z0-9_-]/g, "_") || "schema";
  return `migration-${safeSchema}-${stamp}.sql`;
}
