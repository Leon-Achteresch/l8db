import { useSortable } from "@dnd-kit/react/sortable";
import {
  BracesIcon,
  CopyIcon,
  EyeIcon,
  PackageIcon,
  SquareTerminalIcon,
  TableIcon,
  UsersIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type * as React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SPRING } from "@/lib/ease";
import { isQueryTabDirty, type Tab, tabKey } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

export interface TableTabsSortableTabProps {
  tab: Tab;
  index: number;
  isActive: boolean;
  hasTabsToRight: boolean;
  tabsCount: number;
  onNavigate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  onAuxClick: (event: React.MouseEvent) => void;
  onMouseDown: (event: React.MouseEvent) => void;
  onCopyTable?: () => void;
  onCopyFull?: () => void;
}

function tabVisual(tab: Tab) {
  switch (tab.kind) {
    case "query":
      return { Icon: SquareTerminalIcon, iconColor: "text-sky-500" };
    case "function":
      return { Icon: BracesIcon, iconColor: "text-violet-500" };
    case "procedure":
      return { Icon: BracesIcon, iconColor: "text-fuchsia-500" };
    case "extension":
      return { Icon: PackageIcon, iconColor: "text-amber-500" };
    case "package":
      return { Icon: PackageIcon, iconColor: "text-violet-500" };
    case "role":
      return { Icon: UsersIcon, iconColor: "text-rose-500" };
    case "trigger":
      return { Icon: ZapIcon, iconColor: "text-orange-500" };
    case "view-editor":
      return { Icon: EyeIcon, iconColor: "text-cyan-500" };
    case "alter-table":
      return { Icon: WrenchIcon, iconColor: "text-orange-500" };
    default:
      return (tab.entityType ?? "table") === "view"
        ? { Icon: EyeIcon, iconColor: "text-cyan-500" }
        : { Icon: TableIcon, iconColor: "text-emerald-500" };
  }
}

export function TableTabsSortableTab({
  tab,
  index,
  isActive,
  hasTabsToRight,
  tabsCount,
  onNavigate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onAuxClick,
  onMouseDown,
  onCopyTable,
  onCopyFull,
}: TableTabsSortableTabProps) {
  const reduce = useReducedMotion();
  const { ref, isDragging } = useSortable({ id: tabKey(tab), index });

  const { Icon, iconColor } = tabVisual(tab);

  const label =
    tab.kind === "table"
      ? tab.table
      : tab.kind === "query"
        ? tab.title
        : tab.kind === "function" || tab.kind === "procedure"
          ? tab.name
          : tab.kind === "trigger"
            ? tab.trigger
            : tab.kind === "view-editor"
              ? tab.view
              : tab.kind === "alter-table"
                ? tab.table
                : tab.name;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <motion.div
          ref={ref}
          layout={!isDragging ? "position" : false}
          transition={{ layout: SPRING }}
          onAuxClick={onAuxClick}
          onMouseDown={onMouseDown}
          className={cn(
            "group relative flex h-8 shrink-0 cursor-grab items-center rounded-full border pl-2.5 pr-1 text-sm transition-all active:cursor-grabbing",
            isActive
              ? "border-primary/30 bg-card text-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-accent/60 hover:text-foreground",
            isDragging && "z-10 cursor-grabbing opacity-90 shadow-md ring-1 ring-ring/40",
          )}
        >
          {isActive && (
            <motion.span
              layoutId={reduce ? undefined : "workspace-active-tab"}
              transition={SPRING}
              className="pointer-events-none absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
            />
          )}
          <span
            className={cn(
              "mr-2 size-1.5 shrink-0 rounded-full transition-colors",
              isActive ? "bg-primary" : "bg-transparent",
            )}
          />
          <button
            type="button"
            onClick={onNavigate}
            className="flex max-w-44 items-center gap-2 truncate py-1 text-left"
          >
            <Icon className={cn("size-3.5 shrink-0", iconColor)} />
            <span className="truncate font-medium">{label}</span>
            {tab.kind === "query" && tab.externalChange && (
              <span className="shrink-0 text-amber-500" title="Datei extern geändert">!</span>
            )}
            {tab.kind === "query" && isQueryTabDirty(tab) && (
              <span className="shrink-0 text-amber-500" title="Ungespeicherte Änderungen">●</span>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${label} schließen`}
            className={cn(
              "ml-1.5 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-all hover:bg-foreground/10 hover:text-foreground",
              isActive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            <XIcon className="size-3.5" />
          </button>
        </motion.div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={onClose}>
          Schließen
          <ContextMenuShortcut>
            <XIcon className="size-3.5" />
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={tabsCount <= 1} onSelect={onCloseOthers}>
          Andere schließen
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasTabsToRight} onSelect={onCloseToRight}>
          Tabs rechts schließen
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>Alle schließen</ContextMenuItem>
        {tab.kind === "table" && onCopyTable && onCopyFull && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onCopyTable}>
              Tabellenname kopieren
              <ContextMenuShortcut>
                <CopyIcon className="size-3.5" />
              </ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCopyFull}>Vollständigen Namen kopieren</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
