import type { SavedConnection } from "@/lib/connections";
import { executeInTransaction, rollbackTransaction } from "@/lib/db";
import { checkResult, validateCheck } from "./safety";
import { requalify } from "./schema";
import { openVersioningSession } from "./session";
import type { DatabaseRelease, DatabaseTarget, ReleaseCheck } from "./types";

export function mappedCheck(
  check: ReleaseCheck,
  release: DatabaseRelease,
  target: DatabaseTarget,
): ReleaseCheck {
  if (!target.schema) return check;
  const schemas = [...new Set(release.objects.map((item) => item.object.selection.schema))];
  if (schemas.length !== 1 || !schemas[0])
    throw new Error("Prüfungen benötigen eine eindeutige Schema-Zuordnung.");
  return { ...check, sql: requalify(check.sql, schemas[0], target.schema) };
}

export async function runReleaseChecks(
  transaction: string,
  release: DatabaseRelease,
  target: DatabaseTarget,
  phase: "preconditions" | "postconditions",
  onChecked?: (id: string) => void,
) {
  for (const entry of release.safety?.[phase] ?? []) {
    const check = mappedCheck(entry, release, target);
    const result = await executeInTransaction(transaction, validateCheck(check.sql, release.kind), {
      confirmed: true,
    });
    checkResult(result, check);
    onChecked?.(`${release.id}:${phase}:${check.id}`);
  }
}

export async function preflightChecks(
  connection: SavedConnection,
  target: DatabaseTarget,
  release: DatabaseRelease,
) {
  if (!release.safety?.preconditions.length) return;
  const transaction = await openVersioningSession(connection, target, release, true);
  try {
    await runReleaseChecks(transaction, release, target, "preconditions");
  } finally {
    await rollbackTransaction(transaction);
  }
}
