import { Link, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GitBranchIcon, Minus, PlugZap, RefreshCw, Settings, Square, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Tooltip } from "@/components/motion/tooltip";
import { AppHeaderSearch } from "@/features/shell/app-header-search";
import { ReadOnlyBadge } from "@/features/shell/read-only-badge";
import { appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useWindowTitle } from "@/lib/hooks/use-window-title";
import { useRefreshConnection } from "@/lib/queries";
import { useTransactionStore } from "@/lib/transactions";
import { cn } from "@/lib/utils";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

const IS_WINDOWS = typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

async function runWindowAction(action: "minimize" | "toggleMaximize" | "close") {
  const win = getCurrentWindow();
  if (action === "minimize") await win.minimize();
  else if (action === "toggleMaximize") await win.toggleMaximize();
  else await win.close();
}

function WindowControls() {
  const base =
    "inline-flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors cursor-pointer hover:bg-muted hover:text-foreground";
  return (
    <div
      data-tauri-drag-region="false"
      className="absolute right-0 top-0 z-30 flex h-full items-stretch"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Minimieren"
        className={base}
        onClick={() => void runWindowAction("minimize")}
      >
        <Minus className="size-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label="Maximieren"
        className={base}
        onClick={() => void runWindowAction("toggleMaximize")}
      >
        <Square className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label="Schließen"
        className={cn(base, "hover:bg-destructive hover:text-white")}
        onClick={() => void runWindowAction("close")}
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}

function isNavActive(url: string, pathname: string) {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const txCount = useTransactionStore((s) => s.transactions.length);
  const panelOpen = useTransactionStore((s) => s.panelOpen);
  const togglePanel = useTransactionStore((s) => s.togglePanel);
  const syncWithBackend = useTransactionStore((s) => s.syncWithBackend);
  const { refresh, isRefreshing, canRefresh } = useRefreshConnection();

  useWindowTitle();

  useEffect(() => {
    syncWithBackend();
  }, [syncWithBackend]);

  return (
    <header
      data-tauri-drag-region="deep"
      className={cn(
        "relative z-20 flex h-[var(--app-header-height)] shrink-0 select-none items-center gap-0",
        "border-b border-border/60",
        "bg-card/80 backdrop-blur-xl backdrop-saturate-150 dark:bg-background/72",
        IS_MAC && "pl-[72px]",
        IS_WINDOWS && "pr-[140px]",
      )}
    >
      <nav
        data-tour="header-nav"
        className="flex items-center gap-1 px-3"
        aria-label="Bereiche"
      >
        <Link
          to="/"
          className="mr-1 inline-flex h-7 shrink-0 items-center px-1 text-sm font-semibold tracking-tight"
        >
          l8db
        </Link>
        {appSidebarData.navMain.map((item) => {
          const active = isNavActive(item.url, pathname);
          return (
            <Tooltip key={item.title} content={item.title} side="bottom">
              <motion.div
                layout="position"
                transition={{ layout: SPRING_LAYOUT }}
                className="relative"
              >
                {active && (
                  <motion.span
                    layoutId="header-nav-active"
                    transition={SPRING_LAYOUT}
                    className="absolute inset-0 rounded-full bg-primary/12"
                  />
                )}
                <Link
                  to={item.url}
                  aria-label={item.title}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
                    "hover:bg-muted hover:text-foreground",
                    active && "text-foreground",
                  )}
                >
                  <item.icon className="size-4" strokeWidth={2} />
                </Link>
              </motion.div>
            </Tooltip>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 justify-center px-4">
        <div className="flex w-full max-w-[640px] items-center gap-2">
          <ReadOnlyBadge />
          <div className="min-w-0 flex-1">
            <AppHeaderSearch />
          </div>
        </div>
      </div>

      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-2" />

      <nav
        data-tour="header-actions"
        className="flex items-center gap-1 px-3"
        aria-label="Hauptnavigation"
      >
        {import.meta.env.DEV && (
          <Tooltip content="DEV · Design Lab" side="bottom">
            <Link
              to="/dev"
              aria-label="DEV · Design Lab"
              aria-current={pathname === "/dev" ? "page" : undefined}
              className={cn(
                "inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                pathname === "/dev" && "bg-primary/12 text-foreground",
              )}
            >
              DEV
            </Link>
          </Tooltip>
        )}
        {canRefresh ? (
          <Tooltip content="Objekte neu laden" side="bottom">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Objekte aktualisieren"
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer",
                "hover:bg-muted hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} strokeWidth={2} />
            </button>
          </Tooltip>
        ) : null}

        <Tooltip content="Transaktionen" side="bottom">
          <button
            type="button"
            onClick={togglePanel}
            data-tour="header-tx"
            aria-label="Transaktionen"
            className={cn(
              "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer",
              "hover:bg-muted hover:text-foreground",
              panelOpen && "bg-primary/12 text-foreground",
            )}
          >
            <GitBranchIcon className="size-4" strokeWidth={2} />
            {txCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                {txCount}
              </span>
            )}
          </button>
        </Tooltip>

        <div className="mx-0.5 h-5 w-px bg-border/60" aria-hidden />

        <ThemeToggle
          variant="circle-blur"
          start="top-right"
          className="size-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          iconClassName="size-4"
        />

        <Tooltip content="Treiber" side="bottom">
          <Link
            to="/drivers"
            aria-label="Treiber"
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              pathname.startsWith("/drivers") && "bg-primary/12 text-foreground",
            )}
          >
            <PlugZap className="size-4" strokeWidth={2} />
          </Link>
        </Tooltip>

        <Tooltip content="Einstellungen" side="bottom">
          <Link
            to="/settings"
            aria-label="Einstellungen"
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              pathname.startsWith("/settings") && "bg-primary/12 text-foreground",
            )}
          >
            <Settings className="size-4" strokeWidth={2} />
          </Link>
        </Tooltip>
      </nav>

      {IS_WINDOWS ? <WindowControls /> : null}
    </header>
  );
}
