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
import { motion } from "motion/react";
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
import { tabLabel } from "@/lib/tab-navigation";
import { isQueryTabDirty, type Tab, tabKey } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

export interface TableTabsSortableTabProps {
  tab: Tab;
  index: number;
  isActive: boolean;
  isInPane?: boolean;
  canSplit?: boolean;
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
  onSplit?: () => void;
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
  isInPane = false,
  canSplit = true,
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
  onSplit,
}: TableTabsSortableTabProps) {
  const { ref, isDragging } = useSortable({
    id: tabKey(tab),
    index,
    type: "tab",
    accept: ["tab"],
    data: { key: tabKey(tab) },
  });

  const { Icon, iconColor } = tabVisual(tab);

  const label = tabLabel(tab);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <motion.div
          ref={ref}
          data-tab-key={tabKey(tab)}
          layout={!isDragging ? "position" : false}
          transition={{ layout: SPRING }}
          onAuxClick={onAuxClick}
          onMouseDown={onMouseDown}
          className={cn(
            "group relative flex h-7 shrink-0 cursor-grab items-center rounded-full pl-1 pr-0.5 text-xs transition-[background-color,box-shadow,color] duration-200 active:cursor-grabbing",
            isActive
              ? "bg-card text-foreground shadow-[0_1px_3px_color-mix(in_oklab,var(--primary)_14%,transparent)] ring-1 ring-inset ring-primary/10"
              : isInPane
                ? "bg-accent/40 text-foreground ring-1 ring-inset ring-border/70"
                : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
            isDragging && "z-10 cursor-grabbing opacity-90 shadow-md ring-1 ring-ring/40",
          )}
        >
          <button
            type="button"
            onClick={onNavigate}
            title={label}
            aria-pressed={isActive}
            className="flex h-full min-w-0 max-w-44 items-center gap-1.5 rounded-full pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span
              className={cn(
                "relative grid size-5 shrink-0 place-items-center rounded-full before:absolute before:inset-0 before:rounded-full before:bg-current before:opacity-10",
                iconColor,
              )}
            >
              <Icon className="relative size-3" />
            </span>
            <span className="truncate font-medium">{label}</span>
            {tab.kind === "query" && tab.externalChange && (
              <span className="shrink-0 text-amber-500" title="Datei extern geändert">
                !
              </span>
            )}
            {tab.kind === "query" && isQueryTabDirty(tab) && (
              <span className="shrink-0 text-amber-500" title="Ungespeicherte Änderungen">
                ●
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${label} schließen`}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground/70 transition-[background-color,color,opacity,transform] duration-200 hover:bg-foreground/10 hover:text-foreground motion-safe:active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            <XIcon className="size-3" />
          </button>
        </motion.div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={onClose}>
          Schließen
          <ContextMenuShortcut>
            <XIcon className="size-3" />
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={tabsCount <= 1} onSelect={onCloseOthers}>
          Andere schließen
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasTabsToRight} onSelect={onCloseToRight}>
          Tabs rechts schließen
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>Alle schließen</ContextMenuItem>
        {onSplit && (
          <ContextMenuItem disabled={!canSplit} onSelect={onSplit}>
            Rechts teilen
          </ContextMenuItem>
        )}
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
