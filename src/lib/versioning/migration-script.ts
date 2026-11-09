import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { targetStage } from "./delivery";
import { LEDGER_READY, ledgerTable } from "./ledger";
import { checksum } from "./model";
import type {
  DatabaseRelease,
  DatabaseTarget,
  DeployKind,
  ReleaseReference,
  VersioningProject,
} from "./types";

export interface ScriptPlan {
  target: DatabaseTarget;
  from: DatabaseRelease;
  to: DatabaseRelease;
  reference: ReleaseReference;
  releases: DatabaseRelease[];
  sql: string[];
  reviewArtifact?: string;
  ledger?: ScriptLedger;
}

export interface ScriptLedger {
  guard: string;
  statements: string[];
}

interface ExecutionStep {
  id: string;
  hash: string;
  changes: { id: string; checksum: string; kind: string; touches: { id: string }[] }[];
}

interface Execution {
  fromId: string;
  fromHash: string;
  mode?: string;
  objects: { id: string; definition: string }[];
  variances: { id: string }[];
  releases: ExecutionStep[];
}

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

export async function scriptLedger(
  plan: ScriptPlan,
  project: VersioningProject,
): Promise<ScriptLedger | undefined> {
  if (!plan.reviewArtifact) return undefined;
  const execution = (JSON.parse(plan.reviewArtifact) as { execution: Execution }).execution;
  const oracle = project.kind === "oracle";
  const id = literal(project.id);
  const state = ledgerTable(project, plan.target);
  const changes = ledgerTable(project, plan.target, "CHANGES");
  const objects = ledgerTable(project, plan.target, "OBJECTS");
  const now = oracle ? "SYS_EXTRACT_UTC(SYSTIMESTAMP)" : "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')";
  const actor = oracle ? "SYS_CONTEXT('USERENV','SESSION_USER')" : "session_user";
  const single = execution.mode === "change";
  const ready = `"PROJECT_ID" = ${id} AND "RELEASE_HASH" = ${literal(execution.fromHash)} AND "STATUS" = '${LEDGER_READY}' AND "LEASE" IS NULL`;
  const message = (text: string) => literal(`l8db: ${text}`);
  const mismatch = message(
    `Ziel steht nicht auf ${execution.fromId} oder ein Rollout läuft. Skript neu erzeugen.`,
  );
  const guard = oracle
    ? `DECLARE n NUMBER; BEGIN SELECT COUNT(*) INTO n FROM ${state} WHERE ${ready}; IF n <> 1 THEN RAISE_APPLICATION_ERROR(-20001, ${mismatch}); END IF; END;`
    : `DO $l8db$ BEGIN IF (SELECT COUNT(*) FROM ${state} WHERE ${ready}) <> 1 THEN RAISE EXCEPTION ${mismatch}; END IF; END $l8db$`;
  const definitions = new Map(execution.objects.map((entry) => [entry.id, entry.definition]));
  const variances = new Set(execution.variances.map((entry) => entry.id));
  const statements: string[] = [];
  const settled = new Map<string, string>();
  for (const step of execution.releases) {
    for (const change of step.changes) {
      statements.push(
        `INSERT INTO ${changes} ("PROJECT_ID", "CHANGE_ID", "CHECKSUM", "KIND", "SOURCE", "RELEASE_ID", "RUN_ID", "APPLIED_AT", "APPLIED_BY") VALUES (${id}, ${literal(change.id)}, ${literal(change.checksum)}, ${literal(change.kind)}, 'script', ${single ? "NULL" : literal(step.id)}, NULL, ${now}, ${actor})`,
      );
      if (!single)
        for (const touch of change.touches)
          if (!variances.has(touch.id) && definitions.has(touch.id))
            settled.set(touch.id, change.id);
    }
  }
  for (const [object] of [...settled].sort(([a], [b]) => a.localeCompare(b))) {
    const hash = literal(await checksum(definitions.get(object) ?? ""));
    statements.push(
      oracle
        ? `MERGE INTO ${objects} t USING (SELECT ${id} AS p, ${literal(object)} AS o, ${hash} AS h FROM dual) s ON (t."PROJECT_ID" = s.p AND t."OBJECT_ID" = s.o) WHEN MATCHED THEN UPDATE SET t."APPLIED_HASH" = s.h, t."CHANGE_ID" = NULL, t."APPLIED_AT" = ${now} WHEN NOT MATCHED THEN INSERT ("PROJECT_ID", "OBJECT_ID", "APPLIED_HASH", "CHANGE_ID", "APPLIED_AT") VALUES (s.p, s.o, s.h, NULL, ${now})`
        : `INSERT INTO ${objects} ("PROJECT_ID", "OBJECT_ID", "APPLIED_HASH", "CHANGE_ID", "APPLIED_AT") VALUES (${id}, ${literal(object)}, ${hash}, NULL, ${now}) ON CONFLICT ("PROJECT_ID", "OBJECT_ID") DO UPDATE SET "APPLIED_HASH" = EXCLUDED."APPLIED_HASH", "CHANGE_ID" = EXCLUDED."CHANGE_ID", "APPLIED_AT" = EXCLUDED."APPLIED_AT"`,
    );
  }
  const last = execution.releases.at(-1);
  if (last) {
    const advance = `UPDATE ${state} SET "RELEASE_ID" = ${literal(last.id)}, "RELEASE_HASH" = ${literal(last.hash)} WHERE ${ready}`;
    statements.push(
      oracle
        ? `BEGIN ${advance}; IF SQL%ROWCOUNT <> 1 THEN RAISE_APPLICATION_ERROR(-20001, ${mismatch}); END IF; END;`
        : `DO $l8db$ BEGIN ${advance}; IF NOT FOUND THEN RAISE EXCEPTION ${mismatch}; END IF; END $l8db$`,
    );
  }
  return { guard, statements };
}

const STAGES = { development: "Entwicklung", test: "Test", production: "Produktion" } as const;

const COMMENT_TAIL = /(?:^|\n)((?:[^'\n-]|'[^'\n]*'|-(?!-))*)--[^\n]*$/;
const LEADING_COMMENTS = /^(?:\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/;
const PLSQL =
  /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE|LIBRARY)\b|DECLARE\b|BEGIN\b)/i;

export function terminate(kind: DeployKind, statement: string) {
  const body = statement
    .trimEnd()
    .replace(/\n[ \t]*\/$/, "")
    .trimEnd();
  if (kind === "oracle" && PLSQL.test(body.replace(LEADING_COMMENTS, "")))
    return `${body.replace(/;?$/, ";")}\n/`;
  const tail = COMMENT_TAIL.exec(body);
  if (tail) return tail[1].trimEnd().endsWith(";") ? body : `${body}\n;`;
  return body.endsWith(";") ? body : `${body};`;
}

const comment = (text: string) => text.replace(/\r?\n/g, " ");

export function migrationScript(plan: ScriptPlan, project: string, now = new Date()) {
  const { target, from, to, releases } = plan;
  const kind = to.kind;
  const lines = [
    `-- l8db Migrationsskript · ${comment(project)}`,
    `-- Ziel: ${comment(target.customer ?? target.name)} · ${comment(target.environment ?? STAGES[targetStage(target)])} · ${comment(target.name)}`,
    `-- Schema: ${comment(target.schema ?? target.database ?? "–")}`,
    `-- Release: ${from.id} → ${to.id} · Commit ${plan.reference.commit}`,
    `-- Erstellt: ${now.toISOString()}`,
    "--",
    "-- Für Systeme ohne direkten l8db-Rollout. Vor der Ausführung prüfen und sichern.",
    kind === "oracle"
      ? "-- Ausführen mit SQL*Plus oder SQLcl: @datei.sql"
      : "-- Ausführen mit psql -f datei.sql",
    plan.ledger
      ? "-- Das Skript hakt die Änderungen in der l8db-Abhakliste ab. Danach in l8db unter"
      : "-- Der l8db-Stand dieses Ziels wird dabei nicht fortgeschrieben: danach in l8db unter",
    "-- Kunden → Stand abgleichen den Release bestätigen.",
    "",
  ];
  if (kind === "oracle")
    lines.push(
      "SET DEFINE OFF",
      "SET SQLBLANKLINES ON",
      "WHENEVER SQLERROR EXIT FAILURE ROLLBACK",
      "",
    );
  else lines.push("\\set ON_ERROR_STOP on", "BEGIN;", "");
  if (plan.ledger) lines.push(terminate(kind, plan.ledger.guard), "");
  for (const release of releases)
    lines.push(
      `-- Release ${release.id}: ${release.migrations.map((migration) => comment(migration.title)).join(" · ") || "keine Migrationen"}`,
    );
  lines.push("");
  for (const statement of plan.sql)
    if (statement.trim()) lines.push(terminate(kind, statement), "");
  if (plan.ledger) {
    lines.push("-- l8db-Abhakliste", "");
    for (const statement of plan.ledger.statements) lines.push(terminate(kind, statement), "");
  }
  if (kind === "postgres" || plan.ledger) lines.push("COMMIT;", "");
  return lines.join("\n");
}

export const scriptName = (plan: ScriptPlan) =>
  `migration-${[
    ...new Set([
      plan.target.customer ?? plan.target.name,
      plan.target.environment ?? targetStage(plan.target),
      plan.target.name,
    ]),
    plan.from.id,
    plan.to.id,
  ]
    .join("-")
    .replace(/[^\w.-]+/g, "_")}.sql`;

export function scriptNames(plans: ScriptPlan[]) {
  const used = new Map<string, number>();
  return plans.map((plan) => {
    const name = scriptName(plan);
    const count = (used.get(name) ?? 0) + 1;
    used.set(name, count);
    return count === 1 ? name : name.replace(/\.sql$/, `-${count}.sql`);
  });
}

export async function saveMigrationScripts(source: ScriptPlan[], project: VersioningProject) {
  const plans = await Promise.all(
    source.map(async (plan) => ({ ...plan, ledger: await scriptLedger(plan, project) })),
  );
  if (plans.length === 1) {
    const path = await save({
      defaultPath: scriptName(plans[0]),
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    if (!path) return 0;
    await writeTextFile(path, migrationScript(plans[0], project.name));
    return 1;
  }
  const directory = await open({ directory: true, multiple: false });
  if (typeof directory !== "string") return 0;
  const names = scriptNames(plans);
  for (const [index, plan] of plans.entries())
    await writeTextFile(`${directory}/${names[index]}`, migrationScript(plan, project.name));
  return plans.length;
}
