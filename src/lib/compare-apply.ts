import { loadCompareDefinition } from "@/lib/compare-definition";
import type { CompareSideSelection } from "@/lib/compare-types";
import type { SavedConnection } from "@/lib/connections";
import {
  beginTransaction,
  commitTransaction,
  executeInTransaction,
  executeScript,
  rollbackTransaction,
  validateSql,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";

export async function checkCompareTarget(
  connection: SavedConnection,
  side: CompareSideSelection,
  baseline: string,
): Promise<void> {
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  const current = await loadCompareDefinition(connection, side);
  if (current !== baseline)
    throw new Error(
      "Die Zieldefinition wurde inzwischen verändert. Bitte den Zielstand neu laden und den Entwurf erneut abgleichen.",
    );
}

export async function runComparePlan(
  connection: SavedConnection,
  side: CompareSideSelection,
  statements: string[],
  apply: boolean,
): Promise<void> {
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  const url = effectiveConnectionString(connection);
  const database = side.database ?? undefined;
  if (connection.kind === "postgres") {
    const tx = await beginTransaction(connection.kind, url, database);
    try {
      for (const sql of statements) await executeInTransaction(tx, sql, { confirmed: true });
      if (apply) await commitTransaction(tx);
      else await rollbackTransaction(tx);
    } catch (error) {
      try {
        await rollbackTransaction(tx);
      } catch (rollbackError) {
        throw new Error(`${String(error)}\nRollback fehlgeschlagen: ${String(rollbackError)}`);
      }
      throw error;
    }
    return;
  }
  if (connection.kind !== "oracle")
    throw new Error("Prüfen ohne Speichern wird für diese Datenbank nicht unterstützt.");
  await validateSql(connection.kind, url, statements.join("\n/\n"), database);
  if (!apply) return;
  for (const [index, statement] of statements.entries()) {
    const results = await executeScript(connection.kind, url, statement, database, {
      confirmed: true,
    });
    const failed = results.find((item) => !item.success);
    if (failed || results.length !== 1)
      throw new Error(
        `${failed?.error ?? "Die Anweisung wurde nicht vollständig ausgeführt."}${index > 0 ? " Vorherige Oracle-DDL-Anweisungen sind bereits gespeichert. Bitte den Zielstand neu laden." : ""}`,
      );
  }
}
