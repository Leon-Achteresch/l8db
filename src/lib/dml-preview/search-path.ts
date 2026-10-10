import { create } from "zustand";
import { sqlTokens } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";

interface SearchPathState {
  paths: Record<string, string>;
}

export const useEditorSearchPath = create<SearchPathState>(() => ({ paths: {} }));

function scope(connectionId: string, database: string | null): string {
  return `${connectionId}\n${database ?? ""}`;
}

function searchPathOf(statement: string): string | null | undefined {
  const text = statement.trim().replace(/;\s*$/, "");
  const words = sqlTokens(text, "postgres").map((token) => token.word);
  if (words[0] === "RESET" && (words[1] === "SEARCH_PATH" || words[1] === "ALL")) return null;
  if (words[0] !== "SET") return undefined;
  const assignment = /^SET\s+(?:SESSION\s+)?(?:search_path\s*(?:TO|=)|SCHEMA)\s+([\s\S]+)$/i
    .exec(text)?.[1]
    ?.trim();
  if (!assignment) return undefined;
  if (/^DEFAULT$/i.test(assignment)) return null;
  return assignment
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^'(.*)'$/, "$1")
        .replace(/^"(.*)"$/, "$1"),
    )
    .filter(Boolean)
    .join(", ");
}

export function recordEditorSql(
  connectionId: string,
  database: string | null,
  sql: string,
  dialect: string,
): void {
  if (dialect !== "postgres") return;
  for (const statement of splitSqlStatements(sql, dialect).statements) {
    const path = searchPathOf(statement.text);
    if (path === undefined) continue;
    useEditorSearchPath.setState((state) => {
      const paths = { ...state.paths };
      if (path) paths[scope(connectionId, database)] = path;
      else delete paths[scope(connectionId, database)];
      return { paths };
    });
  }
}

export function editorSearchPath(connectionId: string, database: string | null): string | null {
  return useEditorSearchPath.getState().paths[scope(connectionId, database)] ?? null;
}
