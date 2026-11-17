export function statementCountLabel(statements: number, commands = 0): string {
  const sql = `${statements} Statement${statements === 1 ? "" : "s"}`;
  return commands > 0 ? `${sql} · ${commands} SQL*Plus-Befehl${commands === 1 ? "" : "e"}` : sql;
}
