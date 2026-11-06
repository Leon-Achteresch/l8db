import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide";
import { LinkIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useContext } from "react";
import { DataTableColumnProfile } from "@/features/table/data-table-column-profile";
import { DataTableHeaderName } from "@/features/table/data-table-header-name";
import { cn } from "@/lib/utils";
import type { getColumnTypeInfo } from "./data-table/column-type-info";
import { GridStyleContext } from "./data-table/grid-style-context";
import { renderTypeIcon } from "./data-table/render-type-icon";
import type { TableRow } from "./data-table-types";

type Props = {
  name: string;
  column: Column<TableRow, unknown>;
  typeInfo: ReturnType<typeof getColumnTypeInfo>;
  isFk: boolean;
  fkTitle: string | undefined;
  isFetching: boolean;
};

export function DataTableColumnHeader({
  name,
  column,
  typeInfo,
  isFk,
  fkTitle,
  isFetching,
}: Props) {
  const gridStyle = useContext(GridStyleContext);
  const classic = gridStyle.style === "classic";
  const columnStyle = gridStyle.columns.get(name);
  const sorted = column.getIsSorted();
  const sortButton = (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      disabled={isFetching || !column.getCanSort()}
      className={cn(
        "group flex items-center gap-1 rounded-sm py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer min-w-0 shrink",
        classic ? "px-1" : "px-0.5",
      )}
    >
      {isFk && <LinkIcon className="size-3 shrink-0 text-blue-500" />}
      <DataTableHeaderName name={name} isFk={isFk} />
      <span
        className={cn(
          "shrink-0 text-muted-foreground transition-colors",
          !column.getCanSort()
            ? "hidden"
            : sorted
              ? "text-primary"
              : "opacity-0 group-hover:opacity-100",
        )}
      >
        <MorphIcon
          icon={sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown}
          className={cn("size-3", !sorted && "text-muted-foreground/45")}
        />
      </span>
    </button>
  );

  if (classic)
    return (
      <div className="flex items-center gap-2 w-full min-w-0 justify-start" title={fkTitle}>
        {sortButton}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="flex items-center gap-1 font-mono text-[10px] leading-none whitespace-nowrap text-muted-foreground/80 select-none">
            {renderTypeIcon(typeInfo.iconName, "size-2.5")}
            <span>{typeInfo.label}</span>
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5" title={fkTitle}>
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5",
          columnStyle?.numeric && "justify-end",
        )}
      >
        <span
          title={typeInfo.label}
          className="flex shrink-0 items-center text-muted-foreground/60 select-none"
        >
          {renderTypeIcon(typeInfo.iconName, "size-2.5")}
        </span>
        {sortButton}
      </div>
      {columnStyle?.profile ? (
        <DataTableColumnProfile
          profile={columnStyle.profile}
          temporal={columnStyle.kind === "date"}
        />
      ) : null}
    </div>
  );
}
