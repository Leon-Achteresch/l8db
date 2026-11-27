import type { SortingState } from "@tanstack/react-table";
import type { DetailedColumnInfo } from "@/lib/db/columns";
import type { Capabilities } from "@/lib/db/providers";

const NO_SORT: string[] = [];

export function sortableColumnNames(
  sort: Capabilities["sort"] | undefined,
  details: DetailedColumnInfo[] | undefined,
): string[] | undefined {
  if (sort === "none") return NO_SORT;
  if (sort !== "keyword" || !details) return undefined;
  return details
    .filter(
      (column) =>
        !["object", "nested"].includes(column.data_type) &&
        (column.data_type !== "text" || Boolean(column.comment?.startsWith("Keyword-Feld"))),
    )
    .map((column) => column.name);
}

export function applicableSorting(
  sorting: SortingState,
  sortable: string[] | undefined,
): SortingState {
  if (!sortable || sorting.every((entry) => sortable.includes(entry.id))) return sorting;
  return sorting.filter((entry) => sortable.includes(entry.id));
}

export function sortingLabel(sorting: SortingState | undefined): string {
  const active = sorting?.[0];
  return active?.id ? `${active.desc ? "↓" : "↑"} ${active.id}` : "";
}

export function sameSorting(
  left: SortingState | undefined,
  right: SortingState | undefined,
): boolean {
  return sortingLabel(left) === sortingLabel(right);
}
