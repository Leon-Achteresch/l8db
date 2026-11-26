import type { DatabaseKind } from "@/lib/db";
import { splitSqlStatements } from "@/lib/sql-statements";
import { parseSqlPlusCommand } from "@/lib/sql-statements/sqlplus";

export function sqlImportSummary(sql: string | null, dialect?: DatabaseKind) {
  if (sql === null) return null;
  const split = splitSqlStatements(sql, dialect, { slashRuns: dialect === "oracle" });
  const statements = split.statements.length;
  const commands = split.commands.reduce(
    (count, command) => count + Number(parseSqlPlusCommand(command.text).type !== "remark"),
    0,
  );
  const labels: string[] = [];
  if (statements || !commands)
    labels.push(
      `${statements.toLocaleString("de-DE")} ${statements === 1 ? "Anweisung" : "Anweisungen"}`,
    );
  if (commands)
    labels.push(
      `${commands.toLocaleString("de-DE")} ${commands === 1 ? "SQL*Plus-Befehl" : "SQL*Plus-Befehle"}`,
    );
  return {
    label: labels.join(" · "),
    hasCommands: commands > 0,
    runnable: !split.unterminated && statements + commands > 0,
    unterminated: split.unterminated,
  };
}

export type SqlImportSummary = ReturnType<typeof sqlImportSummary>;
