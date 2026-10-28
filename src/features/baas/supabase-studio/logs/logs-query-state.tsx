import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

export function LogsQueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(query.error)}
      </p>
    );
  if (query.data === undefined)
    return <p className="text-xs text-muted-foreground">Wird geladen…</p>;
  return <>{children(query.data)}</>;
}
