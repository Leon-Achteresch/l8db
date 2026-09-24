import { Link } from "@tanstack/react-router";
import { Bot, GitBranchIcon, GitPullRequestIcon, PlugZap, RefreshCw, Settings } from "lucide-react";
import { useEffect } from "react";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Tooltip } from "@/components/motion/tooltip";
import { AppHeaderNavigation } from "@/features/shell/app-header-navigation";
import { AppHeaderSearch } from "@/features/shell/app-header-search";
import { ProxyUserSwitch } from "@/features/shell/proxy-user-switch";
import { ReadOnlyBadge } from "@/features/shell/read-only-badge";
import { WindowControls } from "@/features/shell/window-controls";
import { useActiveCapabilities } from "@/lib/db-selection";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { useVisibleUpdate } from "@/lib/hooks/use-visible-update";
import { useWindowTitle } from "@/lib/hooks/use-window-title";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { useRefreshConnection } from "@/lib/queries";
import { useSettingsStore } from "@/lib/settings";
import { useTransactionStore } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import { useVersioningPanel } from "@/lib/versioning/panel";

const HEADER_SECTIONS = ["/about", "/dev", "/drivers", "/mcp", "/settings"];

function headerSection(pathname: string) {
  return HEADER_SECTIONS.find((section) =>
    section === "/about" || section === "/dev"
      ? pathname === section
      : pathname.startsWith(section),
  );
}

export function AppHeader() {
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const versioning = useVersioningPanel();
  const section = useRouterSelect((s) => headerSection(s.location.pathname));
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

  if (section === "/about") return null;

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
      <AppHeaderNavigation />

      <div className="@container/header-search flex min-w-0 flex-1 justify-center px-2 @min-[54rem]:px-4">
        <div className="flex w-full max-w-[640px] items-center gap-2">
          <ReadOnlyBadge />
          <ProxyUserSwitch />
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
        {!easyMode && import.meta.env.DEV && (
          <Tooltip content="DEV · Design Lab" side="bottom">
            <Link
              to="/dev"
              aria-label="DEV · Design Lab"
              aria-current={section === "/dev" ? "page" : undefined}
              className={cn(
                "inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                section === "/dev" && "bg-primary/12 text-foreground",
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

        {!easyMode && (
          <Tooltip
            content={
              versioning.pending
                ? `Versionierung · ${versioning.pending} offen`
                : versioning.hasError
                  ? "Versionierung · Status prüfen"
                  : "Versionierung"
            }
            side="bottom"
          >
            <button
              type="button"
              aria-label={
                versioning.pending ? `Versionierung: ${versioning.pending} offen` : "Versionierung"
              }
              aria-expanded={versioning.open}
              aria-controls="versioning-panel"
              aria-description="Beta"
              onClick={() => versioning.setOpen(!versioning.open)}
              className={cn(
                "relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                versioning.open && "bg-primary/12 text-foreground",
              )}
            >
              <GitPullRequestIcon className="size-4" strokeWidth={2} />
              <span className="pointer-events-none absolute -right-2 -top-0.5 rounded-full bg-primary px-1 font-medium text-[8px] text-primary-foreground leading-[1.3]">
                Beta
              </span>
              {versioning.pending > 0 ? (
                <span
                  data-testid="versioning-badge"
                  className="absolute -bottom-1 -left-1 flex min-w-3.5 h-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-bold tabular-nums text-primary-foreground"
                >
                  {versioning.pending > 99 ? "99+" : versioning.pending}
                </span>
              ) : versioning.hasError ? (
                <span
                  role="img"
                  aria-label="Status nicht verfügbar"
                  className="absolute right-0 top-0 size-1.5 rounded-full bg-amber-500"
                />
              ) : null}
            </button>
          </Tooltip>
        )}

        {((!easyMode && caps.transactions) || txCount > 0) && (
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
        )}

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
              section === "/drivers" && "bg-primary/12 text-foreground",
            )}
          >
            <PlugZap className="size-4" strokeWidth={2} />
          </Link>
        </Tooltip>

        {!easyMode && (
          <Tooltip content="MCP" side="bottom">
            <Link
              to="/mcp"
              aria-label="MCP"
              className={cn(
                "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground",
                section === "/mcp" && "bg-primary/12 text-foreground",
              )}
            >
              <Bot className="size-4" strokeWidth={2} />
            </Link>
          </Tooltip>
        )}

        <Tooltip content="Einstellungen" side="bottom">
          <Link
            to="/settings"
            aria-label="Einstellungen"
            className={cn(
              "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              section === "/settings" && "bg-primary/12 text-foreground",
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
