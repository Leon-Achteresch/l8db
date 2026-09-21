import { splitSqlStatements } from "@/lib/sql-statements";
import { checksum, identifier } from "./model";
import { sqlCode } from "./sql-code";
import type { DatabaseRelease, ReleaseCheck, ReleaseSafety, VersioningKind } from "./types";

export const defaultSafety = (): ReleaseSafety => ({
  phase: "custom",
  compatibility: "online",
  notes: "",
  lockTimeoutMs: 5000,
  statementTimeoutMs: 60000,
  preconditions: [],
  postconditions: [],
});

export function validateCheck(sql: string, kind: VersioningKind): string {
  const split = splitSqlStatements(sql, kind);
  const code = sqlCode(sql);
  if (
    split.unterminated ||
    split.statements.length !== 1 ||
    !/^SELECT\b/i.test(code) ||
    /\b(?:INTO|INSERT|UPDATE|DELETE|MERGE|CALL|COPY|NEXTVAL|SETVAL|SET_CONFIG|DBMS_LOCK)\b/i.test(
      code,
    )
  )
    throw new Error(
      "Eine Prüfung benötigt genau eine SELECT-Abfrage ohne Schreib- oder Sperroperationen.",
    );
  return split.statements[0].text;
}

export async function validateSafety(safety: ReleaseSafety, kind: VersioningKind) {
  if (
    !safety ||
    !["expand", "backfill", "contract", "custom"].includes(safety.phase) ||
    !["online", "maintenance"].includes(safety.compatibility) ||
    typeof safety.notes !== "string" ||
    !Number.isInteger(safety.lockTimeoutMs) ||
    safety.lockTimeoutMs < 100 ||
    safety.lockTimeoutMs > 60000 ||
    !Number.isInteger(safety.statementTimeoutMs) ||
    safety.statementTimeoutMs < safety.lockTimeoutMs ||
    safety.statementTimeoutMs > 3600000 ||
    !Array.isArray(safety.preconditions) ||
    !Array.isArray(safety.postconditions)
  )
    throw new Error("Ungültige Betriebs- oder Zeitlimit-Einstellungen im Release.");
  const ids = new Set<string>();
  for (const check of [...safety.preconditions, ...safety.postconditions]) {
    if (
      !check ||
      !identifier(check.id) ||
      ids.has(check.id) ||
      !check.title?.trim() ||
      typeof check.sql !== "string" ||
      typeof check.expected !== "string" ||
      (await checksum(check.sql)) !== check.checksum
    )
      throw new Error("Ungültige, doppelte oder veränderte Release-Prüfung.");
    validateCheck(check.sql, kind);
    ids.add(check.id);
  }
}

export function checkResult(
  result: { columns: string[]; rows: Record<string, unknown>[] },
  check: ReleaseCheck,
) {
  if (result.columns.length !== 1 || result.rows.length !== 1)
    throw new Error(`${check.title}: Prüfung muss genau eine Zeile und eine Spalte liefern.`);
  const value = result.rows[0][result.columns[0]];
  if (value === null || value === undefined || String(value) !== check.expected)
    throw new Error(`${check.title}: Erwartetes Prüfergebnis wurde nicht erreicht.`);
}

export function releaseRisks(release: DatabaseRelease): string[] {
  const codes = release.migrations.flatMap((migration) =>
    splitSqlStatements(migration.sql, release.kind).statements.map((s) => sqlCode(s.text)),
  );
  const risks = new Set<string>();
  if (!release.safety)
    risks.add("Betriebsplan und Datenprüfungen fehlen in diesem älteren Release.");
  if (release.safety?.phase === "contract")
    risks.add("Contract: Alte Anwendungsversionen müssen außer Betrieb sein.");
  for (const code of codes) {
    if (
      /^(?:DROP|TRUNCATE)\b|^ALTER\s+TABLE\b[\s\S]*\b(?:DROP|RENAME|ALTER\s+COLUMN|MODIFY)\b/i.test(
        code,
      )
    )
      risks.add(
        "Entfernen, Umbenennen oder Typänderung kann Daten und bestehende Anwendungen beeinträchtigen.",
      );
    if (/^(?:UPDATE|DELETE|MERGE|INSERT)\b/i.test(code))
      risks.add(
        "Datenänderung: Volumen, Wiederaufnahme und fachliche Ergebnisse prüfen; große Backfills in Batches ausführen.",
      );
    if (/^ALTER\s+TABLE\b|^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(code))
      risks.add(
        "DDL kann Tabellen sperren oder vollständig lesen. Zeitlimits und Last auf einer repräsentativen Kopie prüfen.",
      );
    if (/^(?:DO|CALL|BEGIN|DECLARE)\b/i.test(code))
      risks.add("Programmblock: Dynamisches SQL und Seiteneffekte müssen fachlich geprüft werden.");
    if (
      release.kind === "oracle" &&
      /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?PACKAGE|ALTER\s+PACKAGE)\b/i.test(
        code,
      )
    )
      risks.add(
        "Oracle-Package: Bestehende Sessions können Zustand verlieren (ORA-04068). Session-Wechsel oder EBR im Betriebsplan berücksichtigen.",
      );
  }
  return [...risks];
}

export function requiresMaintenance(release: DatabaseRelease): boolean {
  return (
    release.safety?.phase === "contract" ||
    release.migrations.some((migration) =>
      splitSqlStatements(migration.sql, release.kind).statements.some((statement) =>
        /^(?:DROP|TRUNCATE)\b|^ALTER\s+TABLE\b[\s\S]*\b(?:DROP|RENAME|ALTER\s+COLUMN|MODIFY)\b/i.test(
          sqlCode(statement.text),
        ),
      ),
    )
  );
}

export function validateProductionRelease(release: DatabaseRelease) {
  if (!release.safety?.notes.trim())
    throw new Error(
      `${release.id}: Für Produktion fehlt ein versionierter Betriebsplan. Einen geprüften Nachfolger erstellen.`,
    );
  if (requiresMaintenance(release) && release.safety.compatibility !== "maintenance")
    throw new Error(`${release.id}: Inkompatible Änderungen benötigen einen Wartungsplan.`);
  if (!release.safety.postconditions.length)
    throw new Error(
      `${release.id}: Für Produktion mindestens eine fachliche Nachprüfung definieren.`,
    );
}
