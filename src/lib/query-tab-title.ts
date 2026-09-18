const AUTO_TITLE = /^Query \d+$/;
const VERBS: Record<string, string> = {
  SELECT: "Select",
  WITH: "Select",
  INSERT: "Insert",
  UPDATE: "Update",
  DELETE: "Delete",
  MERGE: "Merge",
  CREATE: "Create",
  ALTER: "Alter",
  DROP: "Drop",
  TRUNCATE: "Truncate",
  CALL: "Call",
  EXEC: "Exec",
  EXECUTE: "Exec",
  GRANT: "Grant",
  REVOKE: "Revoke",
  EXPLAIN: "Explain",
  SHOW: "Show",
};
const OBJECT_PATTERN =
  /\b(?:FROM|INTO|UPDATE|JOIN|TABLE|VIEW|INDEX|FUNCTION|PROCEDURE|SCHEMA|DATABASE|SEQUENCE|TRIGGER|TYPE|CALL|EXEC(?:UTE)?)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?((?:[A-Za-z_][\w$]*|"[^"]+"|`[^`]+`|\[[^\]]+\])(?:\.(?:[A-Za-z_][\w$]*|"[^"]+"|`[^`]+`|\[[^\]]+\]))*)/i;

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

// ponytail: naive regex heuristic; swap for splitSqlStatements + tokenizer if CTE/subquery titles misfire
export function queryTitleFromSql(sql: string): string | null {
  const clean = stripComments(sql).trim();
  const verbMatch = /^\(*\s*([A-Za-z]+)/.exec(clean);
  const keyword = verbMatch ? verbMatch[1].toUpperCase() : "";
  const verb = VERBS[keyword];
  if (!verb) return null;
  let body = clean;
  if (keyword === "WITH") {
    const main = /\)\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.exec(clean);
    if (main) body = clean.slice(main.index + 1);
  }
  const objectMatch = OBJECT_PATTERN.exec(body);
  if (!objectMatch) return verb;
  const raw = objectMatch[1].split(".").pop() ?? "";
  const name = raw.replace(/^["`[]|["`\]]$/g, "");
  return name ? `${verb} ${name}` : verb;
}

export function queryTabLabel(tab: { title: string; sql: string; filePath?: string }): string {
  if (tab.filePath || !AUTO_TITLE.test(tab.title)) return tab.title;
  return queryTitleFromSql(tab.sql) ?? tab.title;
}
