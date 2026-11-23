import { type ReactNode, useMemo } from "react";
import { type FilterTree, readPostgresFilterGroups } from "@/lib/filter-parser";

const DISPLAY_LIMIT = 64;

function renderNode(
  tree: FilterTree<string>,
  budget: { remaining: number; truncated: boolean },
): ReactNode {
  if (budget.remaining === 0) {
    budget.truncated = true;
    return null;
  }
  budget.remaining--;
  if (typeof tree === "string") {
    return <code className="min-w-0 whitespace-pre-wrap break-all text-xs">{tree}</code>;
  }
  const all = tree.combinator === "AND";
  const children = tree.children.slice(0, budget.remaining);
  if (children.length < tree.children.length) budget.truncated = true;
  return (
    <div
      className="min-w-0 space-y-1 rounded bg-muted/40 p-1.5"
      data-filter-group={tree.combinator}
    >
      <p className="text-xs font-medium">{all ? "UND · Alle" : "ODER · Mindestens eine"}</p>
      <ul className="space-y-1">
        {children.map((child) => {
          const key = budget.remaining;
          const content = renderNode(child, budget);
          return (
            content && (
              <li key={key} className="min-w-0">
                {content}
              </li>
            )
          );
        })}
      </ul>
    </div>
  );
}

export function FilterGroupingContent({
  sql,
  columns,
  postgres,
}: {
  sql: string;
  columns: string[];
  postgres: boolean;
}) {
  const preview = useMemo(() => {
    if (!postgres) return { note: "Die Gruppierung ist für PostgreSQL-SQL-Filter verfügbar." };
    if (!sql.trim()) return { note: "Der SQL-Filter ist leer." };
    try {
      return { tree: readPostgresFilterGroups(sql, columns) };
    } catch (error) {
      return {
        note: error instanceof Error ? error.message : "Der Ausdruck wird nicht unterstützt.",
      };
    }
  }, [sql, columns, postgres]);
  const budget = { remaining: DISPLAY_LIMIT, truncated: false };
  const body = preview.tree === undefined ? null : renderNode(preview.tree, budget);
  return (
    <>
      <h2 className="text-sm font-medium">Gruppierung des SQL-Filtertexts</h2>
      {body ?? (
        <p className="text-xs text-muted-foreground">
          {preview.note} Der Filtertext bleibt verfügbar.
        </p>
      )}
      {budget.truncated ? (
        <p className="text-xs text-muted-foreground">Weitere Bedingungen stehen im Filtertext.</p>
      ) : null}
    </>
  );
}
