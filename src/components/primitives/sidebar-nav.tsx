import { PanelLeftClose, PanelLeftOpen, Search, SquarePen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { GlideMenu } from "./glide-menu";
import { type SidebarNavItem, SidebarNavRow } from "./sidebar-nav-row";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function SidebarNav({
  label,
  title,
  items,
  activeId,
  busy = false,
  collapsible = false,
  headerActions,
  empty,
  onPick,
  onNew,
  onRename,
  menu,
  className,
}: {
  label: string;
  title?: string;
  items: SidebarNavItem[];
  activeId?: string | null;
  busy?: boolean;
  collapsible?: boolean;
  headerActions?: ReactNode;
  empty?: ReactNode;
  onPick: (id: string) => void;
  onNew?: () => void;
  onRename?: (id: string, label: string) => void;
  menu?: (item: SidebarNavItem, rename: () => void) => ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? items.filter((item) => item.label.toLocaleLowerCase().includes(needle))
    : items;
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };
  const collapse = () => {
    closeSearch();
    setCollapsed(true);
  };
  return (
    <nav
      aria-label={label}
      data-collapsed={collapsed}
      className={cn(
        "group/sidebar-nav relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden transition-[width] duration-300",
        collapsible ? (collapsed ? "w-[3.25rem]" : "w-60") : "w-full",
        className,
      )}
      style={{ transitionTimingFunction: EASE }}
    >
      {(title || collapsible || headerActions) && (
        <div className="flex h-12 shrink-0 items-center gap-0.5 border-b px-2">
          {collapsed ? (
            <button
              type="button"
              aria-label="Seitenleiste ausklappen"
              onClick={() => setCollapsed(false)}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          ) : (
            <>
              <h2 className="mr-auto truncate pl-2 text-[13px] font-semibold">{title}</h2>
              {headerActions}
              {collapsible && (
                <button
                  type="button"
                  aria-label="Seitenleiste einklappen"
                  onClick={collapse}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PanelLeftClose className="size-4" />
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-2">
        {onNew && (
          <button
            type="button"
            aria-label="Neues Gespräch"
            title={collapsed ? "Neues Gespräch" : undefined}
            disabled={busy}
            onClick={onNew}
            className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-xs font-medium text-foreground/80 outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <SquarePen className="size-4 shrink-0" />
            <span
              className={cn(
                "truncate transition-[opacity,translate] duration-200",
                collapsed && "-translate-x-2 opacity-0",
              )}
            >
              Neues Gespräch
            </span>
          </button>
        )}
        <div
          inert={collapsed}
          className={cn(
            "flex min-h-0 flex-1 flex-col transition-[opacity,translate] duration-200",
            collapsed && "-translate-x-2 opacity-0",
          )}
        >
          <div className="relative mt-2 mb-1 h-8 shrink-0">
            <span
              className={cn(
                "absolute inset-y-0 left-2 flex items-center text-[11px] font-medium text-muted-foreground transition-[opacity,translate] duration-200",
                searching && "pointer-events-none -translate-x-1 opacity-0",
              )}
            >
              Verlauf
            </span>
            <div
              className={cn(
                "absolute top-0 right-0 flex h-8 items-center overflow-hidden rounded-md text-muted-foreground transition-[width,background-color,box-shadow] duration-200",
                searching ? "w-full bg-muted/60 shadow-[inset_0_0_0_1px_var(--border)]" : "w-8",
              )}
              style={{ transitionTimingFunction: EASE }}
            >
              {searching ? (
                <>
                  <Search className="ml-2 size-3.5 shrink-0" />
                  <input
                    ref={search}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === "Escape" && closeSearch()}
                    placeholder="Gespräche durchsuchen"
                    aria-label="Gespräche durchsuchen"
                    className="ml-1.5 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    aria-label="Suche schließen"
                    onClick={closeSearch}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  aria-label="Gespräche durchsuchen"
                  disabled={!items.length}
                  onClick={() => setSearching(true)}
                  className="flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-0"
                >
                  <Search className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <GlideMenu rowSelector="[data-row]" className="flex flex-col gap-px">
              {visible.map((item) => (
                <SidebarNavRow
                  key={item.id}
                  item={item}
                  active={item.id === activeId}
                  disabled={busy}
                  onPick={onPick}
                  onRename={onRename}
                  menu={menu}
                />
              ))}
            </GlideMenu>
            {needle && !visible.length && (
              <p className="px-2 py-2 text-xs text-muted-foreground">Keine Gespräche gefunden</p>
            )}
            {!items.length && empty}
          </div>
        </div>
      </div>
    </nav>
  );
}
