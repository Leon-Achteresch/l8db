import { Link, useRouterState } from "@tanstack/react-router";
import { GitBranchIcon, PlugZap, RefreshCw, Settings } from "lucide-react";
import { useEffect } from "react";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Tooltip } from "@/components/motion/tooltip";
import { AppHeaderNavigation } from "@/features/shell/app-header-navigation";
import { AppHeaderSearch } from "@/features/shell/app-header-search";
import { ReadOnlyBadge } from "@/features/shell/read-only-badge";
import { WindowControls } from "@/features/shell/window-controls";
import { useVisibleUpdate } from "@/lib/hooks/use-visible-update";
import { useWindowTitle } from "@/lib/hooks/use-window-title";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { useRefreshConnection } from "@/lib/queries";
import { useTransactionStore } from "@/lib/transactions";
import { cn } from "@/lib/utils";

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const txCount = useTransactionStore((s) => s.transactions.length);
  const panelOpen = useTransactionStore((s) => s.panelOpen);
  const togglePanel = useTransactionStore((s) => s.togglePanel);
  const syncWithBackend = useTransactionStore((s) => s.syncWithBackend);
  const { refresh, isRefreshing, canRefresh } = useRefreshConnection();
  const update = useVisibleUpdate();

  useWindowTitle();

  useEffect(() => {
    syncWithBackend();
  }, [syncWithBackend]);

  return (
    <header
      data-tauri-drag-region="deep"
      className={cn(
        "@container relative z-20 flex h-[var(--app-header-height)] shrink-0 select-none items-center gap-0",
        "border-b border-border/60",
        "bg-card/80 backdrop-blur-xl backdrop-saturate-150 dark:bg-background/72",
        IS_MAC && "pl-[72px]",
        USE_CUSTOM_WINDOW_CONTROLS && "pr-[140px]",
      )}
    >
      <AppHeaderNavigation pathname={pathname} />

      <div className="@container/header-search flex min-w-0 flex-1 justify-center px-2 @min-[54rem]:px-4">
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
              "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              pathname.startsWith("/settings") && "bg-primary/12 text-foreground",
            )}
          >
            <Settings className="size-4" strokeWidth={2} />
            {update ? (
              <span
                aria-hidden
                className="absolute right-0.5 top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-card"
              />
            ) : null}
          </Link>
        </Tooltip>
      </nav>

      {USE_CUSTOM_WINDOW_CONTROLS ? <WindowControls /> : null}
    </header>
  );
}
