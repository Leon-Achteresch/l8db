import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronRightIcon,
  CircleMinusIcon,
  CirclePlusIcon,
  DiffIcon,
  EqualIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { CatalogObjectType } from "@/lib/db";
import {
  type CompareResult,
  type DiffItem,
  type DiffStatus,
  OBJECT_TYPE_META,
  TYPE_ORDER,
} from "@/lib/schema-compare/types";
import { cn } from "@/lib/utils";
import { SchemaObjectIcon } from "./schema-object-icon";

type Row =
  | { kind: "status"; id: string; status: DiffStatus; keys: string[] }
  | { kind: "type"; id: string; status: DiffStatus; type: CatalogObjectType; keys: string[] }
  | { kind: "item"; id: string; item: DiffItem };

const STATUS_ORDER: DiffStatus[] = ["only_source", "only_target", "different", "identical"];

const STATUS_VISUAL: Record<DiffStatus, { Icon: typeof DiffIcon; color: string }> = {
  only_source: { Icon: CirclePlusIcon, color: "text-emerald-500" },
  only_target: { Icon: CircleMinusIcon, color: "text-rose-500" },
  different: { Icon: DiffIcon, color: "text-amber-500" },
  identical: { Icon: EqualIcon, color: "text-muted-foreground" },
};

interface SchemaCompareTreeProps {
  result: CompareResult;
  items: DiffItem[];
  selection: Record<string, boolean>;
  activeKey: string | null;
  expandAll: boolean;
  onToggle: (keys: string[], checked: boolean) => void;
  onActivate: (key: string) => void;
}

function statusTitle(status: DiffStatus, count: number, result: CompareResult): string {
  switch (status) {
    case "only_source":
      return `${count} nur in Quelle (${result.sourceLabel})`;
    case "only_target":
      return `${count} nur im Ziel (${result.targetLabel})`;
    case "different":
      return `${count} unterschiedlich`;
    default:
      return `${count} identisch`;
  }
}

export function SchemaCompareTree({
  result,
  items,
  selection,
  activeKey,
  expandAll,
  onToggle,
  onActivate,
}: SchemaCompareTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const status of STATUS_ORDER) {
      const inStatus = items.filter((item) => item.status === status);
      if (inStatus.length === 0) continue;
      out.push({ kind: "status", id: status, status, keys: inStatus.map((item) => item.key) });
      if (collapsed.has(status)) continue;
      for (const type of TYPE_ORDER) {
        const inType = inStatus.filter((item) => item.type === type);
        if (inType.length === 0) continue;
        const id = `${status}|${type}`;
        out.push({ kind: "type", id, status, type, keys: inType.map((item) => item.key) });
        if (expandAll || expanded.has(id))
          for (const item of inType) out.push({ kind: "item", id: item.key, item });
      }
    }
    return out;
  }, [items, collapsed, expanded, expandAll]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 20,
    useFlushSync: false,
  });

  const flip = (setter: typeof setCollapsed, id: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groupState = (keys: string[]): boolean | "indeterminate" => {
    const count = keys.filter((key) => selection[key]).length;
    if (count === 0) return false;
    return count === keys.length ? true : "indeterminate";
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_10rem_11rem] border-b bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
        <span>Gruppe / Objekt</span>
        <span>Übergeordnet</span>
        <span>Unterschied</span>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        role="tree"
        aria-label="Unterschiede"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index];
            const style = {
              position: "absolute" as const,
              top: 0,
              left: 0,
              width: "100%",
              height: virtual.size,
              transform: `translateY(${virtual.start}px)`,
            };
            if (row.kind === "status") {
              const { Icon, color } = STATUS_VISUAL[row.status];
              const open = !collapsed.has(row.id);
              return (
                <div
                  key={row.id}
                  style={style}
                  role="treeitem"
                  aria-expanded={open}
                  aria-selected={false}
                  tabIndex={-1}
                  className="flex items-center gap-1.5 bg-muted/20 px-2 text-xs font-semibold"
                >
                  <button
                    type="button"
                    className="flex items-center"
                    aria-label={open ? "Zuklappen" : "Aufklappen"}
                    onClick={() => flip(setCollapsed, row.id)}
                  >
                    <ChevronRightIcon
                      className={cn("size-3.5 transition-transform", open && "rotate-90")}
                    />
                  </button>
                  {row.status !== "identical" && (
                    <Checkbox
                      checked={groupState(row.keys)}
                      onCheckedChange={(checked) => onToggle(row.keys, checked === true)}
                      aria-label="Gruppe auswählen"
                    />
                  )}
                  <Icon className={cn("size-3.5", color)} />
                  <span className="truncate">
                    {statusTitle(row.status, row.keys.length, result)}
                  </span>
                  {row.status === "only_target" && (
                    <span className="truncate font-normal text-muted-foreground">
                      – Auswahl löscht im Ziel
                    </span>
                  )}
                </div>
              );
            }
            if (row.kind === "type") {
              const open = expandAll || expanded.has(row.id);
              return (
                <div
                  key={row.id}
                  style={style}
                  role="treeitem"
                  aria-expanded={open}
                  aria-selected={false}
                  tabIndex={-1}
                  className="flex items-center gap-1.5 pl-6 pr-2 text-xs"
                >
                  <button
                    type="button"
                    className="flex items-center"
                    aria-label={open ? "Zuklappen" : "Aufklappen"}
                    onClick={() => flip(setExpanded, row.id)}
                  >
                    <ChevronRightIcon
                      className={cn("size-3.5 transition-transform", open && "rotate-90")}
                    />
                  </button>
                  {row.status !== "identical" && (
                    <Checkbox
                      checked={groupState(row.keys)}
                      onCheckedChange={(checked) => onToggle(row.keys, checked === true)}
                      aria-label={`${OBJECT_TYPE_META[row.type].plural} auswählen`}
                    />
                  )}
                  <SchemaObjectIcon type={row.type} />
                  <button
                    type="button"
                    className="truncate text-left"
                    onClick={() => flip(setExpanded, row.id)}
                  >
                    {OBJECT_TYPE_META[row.type].plural} ({row.keys.length})
                  </button>
                </div>
              );
            }
            const item = row.item;
            const active = item.key === activeKey;
            const related =
              item.status === "only_source" || item.status === "only_target"
                ? item.children.filter((child) => child.object_type !== "column").length
                : 0;
            return (
              <div
                key={row.id}
                style={style}
                role="treeitem"
                aria-selected={active}
                tabIndex={-1}
                onClick={() => onActivate(item.key)}
                onKeyDown={(event) => {
                  if (event.key === " " && item.status !== "identical") {
                    event.preventDefault();
                    onToggle([item.key], !selection[item.key]);
                  }
                }}
                className={cn(
                  "grid cursor-default grid-cols-[minmax(0,1fr)_10rem_11rem] items-center pl-12 pr-2 text-xs hover:bg-accent/50",
                  active && "bg-accent",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {item.status !== "identical" && (
                    <Checkbox
                      checked={Boolean(selection[item.key])}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={(checked) => onToggle([item.key], checked === true)}
                      aria-label={`${item.name} auswählen`}
                    />
                  )}
                  <SchemaObjectIcon type={item.type} />
                  <span className="truncate font-mono">{item.name}</span>
                  {related > 0 && (
                    <span className="shrink-0 text-muted-foreground">+{related}</span>
                  )}
                </span>
                <span className="truncate font-mono text-muted-foreground">
                  {item.parent ?? ""}
                </span>
                <span className="truncate text-muted-foreground">{item.differsBy.join(", ")}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
