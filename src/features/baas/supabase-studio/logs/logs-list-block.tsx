import type { ReactNode } from "react";
import { DatabaseTable } from "../database/database-table";

export function LogsListBlock<T>({
  title,
  headers,
  rows,
  hasMore,
  empty,
  children,
}: {
  title?: string;
  headers: string[];
  rows: T[];
  hasMore: boolean;
  empty: string;
  children: (row: T, index: number) => ReactNode;
}) {
  return (
    <section className="space-y-2">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <DatabaseTable headers={headers}>{rows.map(children)}</DatabaseTable>
        </div>
      )}
      {hasMore && (
        <p className="text-xs text-muted-foreground">Nur die ersten {rows.length} Einträge.</p>
      )}
    </section>
  );
}
