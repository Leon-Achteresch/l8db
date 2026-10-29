import type { ReactNode } from "react";
import { Empty } from "./empty";

export function List<T>({
  items,
  render,
  limit = 100,
  empty,
}: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
  limit?: number;
  empty?: ReactNode;
}) {
  const list: readonly T[] = Array.isArray(items) ? items : [];
  if (list.length === 0) return <Empty>{empty}</Empty>;
  const max = Math.max(1, Math.min(1000, Math.trunc(limit) || 100));
  return (
    <ul className="flex min-w-0 flex-col divide-y divide-border/60 font-sans text-sm">
      {list.slice(0, max).map((item, index) => (
        <li key={index} className="min-w-0 py-1.5">
          {render(item, index)}
        </li>
      ))}
      {list.length > max && (
        <li className="py-1.5 text-xs text-muted-foreground">… {list.length - max} weitere</li>
      )}
    </ul>
  );
}
