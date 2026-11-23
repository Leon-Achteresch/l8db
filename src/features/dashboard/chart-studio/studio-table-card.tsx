import {
  CalendarDaysIcon,
  GripVerticalIcon,
  HashIcon,
  KeyRoundIcon,
  SearchIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { forwardRef, type ReactNode, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { isDateType, isNumericType, PALETTE } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { FieldDragButton } from "../field-drag-button";
import type { DatasetColumn } from "../use-dataset-query";
import type { JoinColumnDrag } from "./studio-model";

const KEYISH = /(?:^id$|_?(?:id|nr|no|key|code|uuid)$)/i;

export const StudioTableCard = forwardRef<
  HTMLDivElement,
  {
    nodeId: string;
    title: string;
    subtitle?: string;
    columns: DatasetColumn[];
    color: number;
    used: Set<string>;
    selected: string | null;
    pending?: boolean;
    loading?: boolean;
    footer?: ReactNode;
    onSelect: (ref: string | null) => void;
    onRemove?: () => void;
    onJoinDrop?: (drag: JoinColumnDrag, column: string) => void;
  }
>(function StudioTableCard(
  {
    nodeId,
    title,
    subtitle,
    columns,
    color,
    used,
    selected,
    pending,
    loading,
    footer,
    onSelect,
    onRemove,
    onJoinDrop,
  },
  ref,
) {
  const [search, setSearch] = useState("");
  const found = columns.filter((c) =>
    (c.column ?? c.label).toLowerCase().includes(search.toLowerCase()),
  );
  const accent = PALETTE[color % PALETTE.length];
  return (
    <div
      ref={ref}
      data-node={nodeId}
      className={cn(
        "relative flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow",
        pending && "border-dashed border-primary/60 shadow-[0_0_0_4px] shadow-primary/10",
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold" title={title}>
            {title}
          </p>
          {subtitle && <p className="truncate text-[10px] text-muted-foreground">{subtitle}</p>}
        </div>
        {onRemove && (
          <IconButton
            variant="ghost"
            size="icon-xs"
            aria-label={`${title} entfernen`}
            onClick={onRemove}
          >
            <XIcon />
          </IconButton>
        )}
      </div>
      {columns.length > 10 && (
        <div className="relative border-b px-2 py-1.5">
          <SearchIcon className="pointer-events-none absolute top-3 left-3.5 size-3 text-muted-foreground" />
          <input
            aria-label={`Spalten in ${title} suchen`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Spalte suchen…"
            className="h-7 w-full rounded-md bg-muted/50 pr-2 pl-6 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      <ul className="max-h-56 overflow-y-auto p-1">
        {loading && columns.length === 0 && (
          <li className="space-y-1 p-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded-md bg-muted" />
            ))}
          </li>
        )}
        {found.map((field) => {
          const name = field.column ?? field.label;
          const Icon = isNumericType(field.type)
            ? HashIcon
            : isDateType(field.type)
              ? CalendarDaysIcon
              : TypeIcon;
          const isUsed = used.has(field.ref);
          return (
            <li key={field.ref}>
              <FieldDragButton
                dragId={`column:${nodeId}:${field.ref}`}
                drag={{ ref: field.ref, join: { node: nodeId, column: name } }}
                dropAccepts={(data) => Boolean(data.join && data.join.node !== nodeId)}
                onFieldDrop={
                  onJoinDrop ? (data) => data.join && onJoinDrop(data.join, name) : undefined
                }
                aria-pressed={selected === field.ref}
                title={`${name} · ${field.type}${pending ? "" : " · ziehen oder klicken"}`}
                onClick={() => onSelect(selected === field.ref ? null : field.ref)}
                className={cn(
                  "group flex w-full cursor-grab items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing data-[drop-target]:bg-primary/15 data-[drop-target]:ring-2 data-[drop-target]:ring-primary",
                  selected === field.ref && "bg-primary/10 text-primary",
                )}
              >
                <Icon className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {KEYISH.test(name) && (
                  <KeyRoundIcon
                    aria-label="Schlüsselspalte"
                    className="size-3 shrink-0 text-amber-500"
                  />
                )}
                {isUsed && (
                  <>
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                    <span className="sr-only">Im Chart verwendet</span>
                  </>
                )}
                <GripVerticalIcon className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground group-focus-within:text-muted-foreground" />
              </FieldDragButton>
            </li>
          );
        })}
      </ul>
      {footer}
    </div>
  );
});
