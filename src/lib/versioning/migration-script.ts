import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { targetStage } from "./delivery";
import type { DatabaseRelease, DatabaseTarget, DeployKind, ReleaseReference } from "./types";

export interface ScriptPlan {
  target: DatabaseTarget;
  from: DatabaseRelease;
  to: DatabaseRelease;
  reference: ReleaseReference;
  releases: DatabaseRelease[];
  sql: string[];
}

const STAGES = { development: "Entwicklung", test: "Test", production: "Produktion" } as const;

const PLSQL =
  /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\b|DECLARE\b|BEGIN\b)/i;

export function terminate(kind: DeployKind, statement: string) {
  const body = statement.replace(/\s+$/, "").replace(/\n\/$/, "");
  if (kind === "oracle" && PLSQL.test(body)) return `${body.replace(/;?$/, ";")}\n/`;
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
    "-- Der l8db-Stand dieses Ziels wird dabei nicht fortgeschrieben: danach in l8db unter",
    "-- Kunden → Stand abgleichen den Release bestätigen.",
    "",
  ];
  if (kind === "oracle") lines.push("WHENEVER SQLERROR EXIT FAILURE ROLLBACK", "");
  else lines.push("\\set ON_ERROR_STOP on", "BEGIN;", "");
  for (const release of releases)
    lines.push(
      `-- Release ${release.id}: ${release.migrations.map((migration) => comment(migration.title)).join(" · ") || "keine Migrationen"}`,
    );
  lines.push("");
  for (const statement of plan.sql)
    if (statement.trim()) lines.push(terminate(kind, statement), "");
  if (kind === "postgres") lines.push("COMMIT;", "");
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

export async function saveMigrationScripts(plans: ScriptPlan[], project: string) {
  if (plans.length === 1) {
    const path = await save({
      defaultPath: scriptName(plans[0]),
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    if (!path) return 0;
    await writeTextFile(path, migrationScript(plans[0], project));
    return 1;
  }
  const directory = await open({ directory: true, multiple: false });
  if (typeof directory !== "string") return 0;
  const names = scriptNames(plans);
  for (const [index, plan] of plans.entries())
    await writeTextFile(`${directory}/${names[index]}`, migrationScript(plan, project));
  return plans.length;
}
