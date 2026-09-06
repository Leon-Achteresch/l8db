import { Link, useRouterState } from "@tanstack/react-router";
import { GitBranchIcon, PlugZap, RefreshCw, Settings } from "lucide-react";
import { type CSSProperties, useEffect } from "react";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Tooltip } from "@/components/motion/tooltip";
import { AppHeaderSearch } from "@/features/shell/app-header-search";
import { useRefreshConnection } from "@/lib/queries";
import { useTransactionStore } from "@/lib/transactions";
import { cn } from "@/lib/utils";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

const IS_WINDOWS = typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const txCount = useTransactionStore((s) => s.transactions.length);
  const panelOpen = useTransactionStore((s) => s.panelOpen);
  const togglePanel = useTransactionStore((s) => s.togglePanel);
  const syncWithBackend = useTransactionStore((s) => s.syncWithBackend);
  const { refresh, isRefreshing, canRefresh } = useRefreshConnection();

  useEffect(() => {
    syncWithBackend();
  }, [syncWithBackend]);

  return (
    <header
      data-tauri-drag-region
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
      className={cn(
        "relative z-20 flex h-[var(--app-header-height)] shrink-0 select-none items-center gap-0",
        "border-b border-border/60",
        "bg-card/80 backdrop-blur-xl backdrop-saturate-150 dark:bg-background/72",
        IS_MAC && "pl-[72px]",
        IS_WINDOWS && "pr-[140px]",
      )}
    >
      <div
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
        className="flex-1 self-stretch"
      />

      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-[460px]">
          <AppHeaderSearch />
        </div>
      </div>

      <nav
        className="flex items-center gap-1 px-3"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        aria-label="Hauptnavigation"
      >
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
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} strokeWidth={2} />
            </button>
          </Tooltip>
        ) : null}

        <Tooltip content="Transaktionen" side="bottom">
          <button
            type="button"
            onClick={togglePanel}
            aria-label="Transaktionen"
            className={cn(
              "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer",
              "hover:bg-muted hover:text-foreground",
              panelOpen && "bg-primary/12 text-foreground",
            )}
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
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
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
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
    </header>
  );
}
