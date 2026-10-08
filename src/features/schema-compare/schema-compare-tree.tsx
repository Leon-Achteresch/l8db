import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { CatalogObjectType } from "@/lib/db";
import {
  type DiffItem,
  type DiffStatus,
  OBJECT_TYPE_META,
  STATUS_LABEL,
  TYPE_ORDER,
} from "@/lib/schema-compare/types";
import { cn } from "@/lib/utils";
import { SchemaObjectIcon } from "./schema-object-icon";
import { StatusMarker } from "./status-marker";

type Row =
  | { kind: "group"; id: string; label: string; count: number; keys: string[]; depth: number }
  | { kind: "item"; id: string; item: DiffItem; depth: number };

export type TreeGrouping = "type" | "status";

const STATUS_ORDER = ["only_source", "only_target", "different"] as const;

const STATUS_RANK: Record<DiffStatus, number> = {
  different: 0,
  only_source: 1,
  only_target: 2,
  identical: 3,
};

interface SchemaCompareTreeProps {
  items: DiffItem[];
  grouping: TreeGrouping;
  identicalCount: number;
  showIdentical: boolean;
  onShowIdenticalChange: (value: boolean) => void;
  selection: Record<string, boolean>;
  activeKey: string | null;
  expandAll: boolean;
  onToggle: (keys: string[], checked: boolean) => void;
  onActivate: (key: string) => void;
}

const STATUS_ACTION: Record<DiffStatus, string> = {
  only_source: "wird im Ziel erstellt",
  only_target: "wird im Ziel gelöscht",
  different: "wird im Ziel angepasst",
  identical: "identisch",
};

export function SchemaCompareTree({
  items,
  grouping,
  identicalCount,
  showIdentical,
  onShowIdenticalChange,
  selection,
  activeKey,
  expandAll,
  onToggle,
  onActivate,
}: SchemaCompareTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const changed = items.filter((item) => item.status !== "identical");
    const pushType = (pool: DiffItem[], prefix: string, depth: number) => {
      for (const type of TYPE_ORDER) {
        const inType = pool
          .filter((item) => item.type === type)
          .sort(
            (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name),
          );
        if (inType.length === 0) continue;
        const id = `${prefix}${type}`;
        out.push({
          kind: "group",
          id,
          label: OBJECT_TYPE_META[type as CatalogObjectType].plural,
          count: inType.length,
          keys: inType.map((item) => item.key),
          depth,
        });
        if (!expandAll && collapsed.has(id)) continue;
        for (const item of inType) out.push({ kind: "item", id: item.key, item, depth });
      }
    };
    if (grouping === "type") pushType(changed, "", 0);
    else
      for (const status of STATUS_ORDER) {
        const inStatus = changed.filter((item) => item.status === status);
        if (inStatus.length === 0) continue;
        const id = `status|${status}`;
        out.push({
          kind: "group",
          id,
          label: `${STATUS_LABEL[status]} – ${STATUS_ACTION[status]}`,
          count: inStatus.length,
          keys: inStatus.map((item) => item.key),
          depth: 0,
        });
        if (!expandAll && collapsed.has(id)) continue;
        pushType(inStatus, `${id}|`, 1);
      }
    if (identicalCount > 0) {
      out.push({
        kind: "group",
        id: "identical",
        label: "Identisch",
        count: identicalCount,
        keys: [],
        depth: 0,
      });
      if (showIdentical)
        for (const item of items.filter((entry) => entry.status === "identical"))
          out.push({ kind: "item", id: item.key, item, depth: 0 });
    }
    return out;
  }, [items, grouping, collapsed, expandAll, identicalCount, showIdentical]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 20,
    useFlushSync: false,
  });

  const flip = (id: string) => {
    if (id === "identical") {
      onShowIdenticalChange(!showIdentical);
      return;
    }
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const groupState = (keys: string[]): boolean | "indeterminate" => {
    const count = keys.filter((key) => selection[key]).length;
    if (count === 0) return false;
    return count === keys.length ? true : "indeterminate";
  };

  return (
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
          if (row.kind === "group") {
            const open =
              row.id === "identical" ? showIdentical : expandAll || !collapsed.has(row.id);
            return (
              <div
                key={row.id}
                style={style}
                role="treeitem"
                aria-expanded={open}
                aria-selected={false}
                tabIndex={-1}
                className={cn(
                  "group flex items-center gap-1.5 pr-2 text-xs font-medium text-muted-foreground",
                  row.depth === 0 ? "pl-2" : "pl-6",
                  row.id === "identical" && "mt-1",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-foreground"
                  aria-label={`${row.label} ${open ? "zuklappen" : "aufklappen"}`}
                  onClick={() => flip(row.id)}
                >
                  <ChevronRightIcon
                    className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
                  />
                  <span className="truncate">{row.label}</span>
                </button>
                {row.keys.length > 0 && (
                  <Checkbox
                    checked={groupState(row.keys)}
                    onCheckedChange={(checked) => onToggle(row.keys, checked === true)}
                    aria-label={`${row.label} auswählen`}
                    className="size-3.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=indeterminate]:opacity-100"
                  />
                )}
                <span className="w-6 text-right font-normal tabular-nums">{row.count}</span>
              </div>
            );
          }
          const item = row.item;
          const active = item.key === activeKey;
          const related =
            item.status === "only_source" || item.status === "only_target"
              ? item.children.filter((child) => child.object_type !== "column").length
              : 0;
          const parent = item.parent && item.parent !== item.name ? item.parent : null;
          return (
            <div
              key={row.id}
              style={style}
              role="treeitem"
              aria-selected={active}
              tabIndex={-1}
              title={[
                `${OBJECT_TYPE_META[item.type].label} ${STATUS_ACTION[item.status]}`,
                item.differsBy.length > 0 ? item.differsBy.join(", ") : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              onClick={() => onActivate(item.key)}
              onKeyDown={(event) => {
                if (event.key === " " && item.status !== "identical") {
                  event.preventDefault();
                  onToggle([item.key], !selection[item.key]);
                }
              }}
              className={cn(
                "flex cursor-default items-center gap-1.5 rounded-sm pr-2 text-xs hover:bg-accent/50",
                row.depth === 0 ? "pl-3" : "pl-7",
                active && "bg-accent",
              )}
            >
              {item.status !== "identical" ? (
                <Checkbox
                  checked={Boolean(selection[item.key])}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) => onToggle([item.key], checked === true)}
                  aria-label={`${item.name} auswählen`}
                  className="size-3.5"
                />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <SchemaObjectIcon type={item.type} />
              <span
                className={cn(
                  "truncate font-mono",
                  item.status === "only_target" &&
                    "text-muted-foreground line-through decoration-muted-foreground/60",
                )}
              >
                {item.name}
              </span>
              {parent && <span className="truncate font-mono text-muted-foreground">{parent}</span>}
              {related > 0 && <span className="shrink-0 text-muted-foreground">+{related}</span>}
              {grouping === "status" && item.differsBy.length > 0 && (
                <span className="min-w-0 truncate text-muted-foreground">
                  {item.differsBy.join(", ")}
                </span>
              )}
              <span className="ml-auto pl-2">
                {item.status === "identical" ? (
                  <span className="sr-only">{STATUS_LABEL.identical}</span>
                ) : (
                  <StatusMarker status={item.status} />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
