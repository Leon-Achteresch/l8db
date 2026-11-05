import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide";
import { LinkIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useContext } from "react";
import { DataTableColumnProfile } from "@/features/table/data-table-column-profile";
import { DataTableHeaderName } from "@/features/table/data-table-header-name";
import { cn } from "@/lib/utils";
import { type getColumnTypeInfo, shortTypeLabel } from "./data-table/column-type-info";
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
        !classic && "px-0.5",
        columnStyle?.numeric && "flex-row-reverse",
      )}
    >
      {isFk && <LinkIcon className="size-3 shrink-0 text-blue-500" />}
      <span className="flex min-w-0 items-center gap-1">
        {classic && typeInfo.kind === "key" && (
          <span className="shrink-0 text-muted-foreground">
            {renderTypeIcon(typeInfo.iconName, "size-3")}
          </span>
        )}
        <DataTableHeaderName name={name} isFk={isFk} />
      </span>
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
      <div
        className={cn(
          "flex w-full min-w-0 flex-col gap-0.5",
          columnStyle?.numeric ? "items-end" : "items-start",
        )}
        title={fkTitle}
      >
        <div className="flex max-w-full min-w-0 items-center">{sortButton}</div>
        <span
          title={typeInfo.dataType ?? typeInfo.label}
          className="max-w-full truncate font-mono text-[11px] leading-3 font-normal text-muted-foreground select-none"
        >
          {shortTypeLabel(typeInfo.dataType ?? typeInfo.label)}
        </span>
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
