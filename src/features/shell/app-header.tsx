import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  GitBranchIcon,
  GitPullRequestIcon,
  PlugZap,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import { AppHeaderNavigation } from "@/features/shell/app-header-navigation";
import { AppHeaderSearch } from "@/features/shell/app-header-search";
import { EnvironmentBadge } from "@/features/shell/environment-badge";
import { ProxyUserSwitch } from "@/features/shell/proxy-user-switch";
import { ReadOnlyBadge } from "@/features/shell/read-only-badge";
import { TemporaryConnectionBadge } from "@/features/shell/temporary-connection-badge";
import { WindowControls } from "@/features/shell/window-controls";
import { useAiStore } from "@/lib/ai/store";
import { useActiveCapabilities } from "@/lib/db-selection";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { useVisibleUpdate } from "@/lib/hooks/use-visible-update";
import { useWindowTitle } from "@/lib/hooks/use-window-title";
import { useHasNewFeatures } from "@/lib/new-features";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { useRefreshConnection } from "@/lib/queries";
import { useSettingsStore } from "@/lib/settings";
import { useTableTabs } from "@/lib/table-tabs";
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
  const navigate = useNavigate();
  const aiPage = useRouterSelect((state) => state.location.pathname === "/ai");
  const aiOpen = useAiStore((state) => state.open);
  const setAiOpen = useAiStore((state) => state.setOpen);
  const headerRef = useRef<HTMLElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLElement>(null);
  const [searchWidth, setSearchWidth] = useState(460);
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const navInHeader = useSettingsStore((state) => state.navInHeader);
  const versioning = useVersioningPanel();
  const section = useRouterSelect((s) => headerSection(s.location.pathname));
  const txCount = useTransactionStore((s) => s.transactions.length);
  const panelOpen = useTransactionStore((s) => s.panelOpen);
  const togglePanel = useTransactionStore((s) => s.togglePanel);
  const syncWithBackend = useTransactionStore((s) => s.syncWithBackend);
  const { refresh, isRefreshing, canRefresh } = useRefreshConnection();
  const update = useVisibleUpdate();
  const hasNewSettingsFeatures = useHasNewFeatures("settings");
  const hasNewVersioningFeatures = useHasNewFeatures("versioning");
  const hasNewAiFeatures = useHasNewFeatures("ai");

  useWindowTitle();

  useEffect(() => {
    syncWithBackend();
  }, [syncWithBackend]);

  useLayoutEffect(() => {
    if (section === "/about") return;
    const header = headerRef.current;
    const leading = leadingRef.current;
    const actions = actionsRef.current;
    if (!header || !leading || !actions) return;

    let headerWidth = 0;
    let leadingWidth = 0;
    let actionsWidth = 0;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width =
          entry.borderBoxSize[0]?.inlineSize ?? entry.target.getBoundingClientRect().width;
        if (entry.target === header) headerWidth = width;
        if (entry.target === leading) leadingWidth = width;
        if (entry.target === actions) actionsWidth = width;
      }
      if (headerWidth && leadingWidth && actionsWidth)
        setSearchWidth(
          Math.max(
            28,
            Math.min(
              460,
              headerWidth -
                2 *
                  Math.max(
                    leadingWidth + (IS_MAC ? 72 : 0),
                    actionsWidth + (USE_CUSTOM_WINDOW_CONTROLS ? 140 : 0),
                  ) -
                16,
            ),
          ),
        );
    });
    observer.observe(header);
    observer.observe(leading);
    observer.observe(actions);
    return () => observer.disconnect();
  }, [section]);

  if (section === "/about") return null;

  return (
    <header
      ref={headerRef}
      data-tauri-drag-region="deep"
      className={cn(
        "@container relative z-20 flex h-[var(--app-header-height)] shrink-0 select-none items-center gap-0",
        "bg-sidebar",
        IS_MAC && "pl-[72px]",
        USE_CUSTOM_WINDOW_CONTROLS && "pr-[140px]",
      )}
    >
      <div ref={leadingRef} className="flex shrink-0 items-center gap-2">
        {navInHeader ? (
          <AppHeaderNavigation />
        ) : (
          <Link
            to="/"
            className="ml-3 inline-flex h-7 shrink-0 items-center px-1 text-sm font-semibold tracking-tight"
          >
            l8db
          </Link>
        )}
        <div className="flex items-center gap-2">
          <EnvironmentBadge />
          <TemporaryConnectionBadge />
          <ReadOnlyBadge />
          <ProxyUserSwitch />
        </div>
      </div>

      <div
        className="@container/header-search absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: searchWidth }}
      >
        <AppHeaderSearch />
      </div>

      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-2" />

      <nav
        ref={actionsRef}
        data-tour="header-actions"
        className="ml-auto flex items-center gap-1 px-3"
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
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors cursor-pointer",
                "hover:bg-muted hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <RefreshCw
                className={cn("size-4", isRefreshing && "animate-spin")}
                strokeWidth={1.75}
              />
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
              aria-description={hasNewVersioningFeatures ? "Neue Funktionen" : undefined}
              onClick={() => {
                if (versioning.mode === "tab") {
                  useTableTabs.getState().openToolTab("versioning");
                  versioning.setOpen(true);
                  void navigate({ to: "/versioning" });
                } else versioning.setOpen(!versioning.open);
              }}
              className={cn(
                "relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                versioning.open && "bg-primary/12 text-foreground",
              )}
            >
              <GitPullRequestIcon className="size-4" strokeWidth={1.75} />
              {hasNewVersioningFeatures ? (
                <span className="pointer-events-none absolute -right-2 -top-0.5 rounded-full bg-primary px-1 font-medium text-[8px] text-primary-foreground leading-[1.3]">
                  NEW
                </span>
              ) : null}
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
                "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors cursor-pointer",
                "hover:bg-muted hover:text-foreground",
                panelOpen && "bg-primary/12 text-foreground",
              )}
            >
              <GitBranchIcon className="size-4" strokeWidth={1.75} />
              {txCount > 0 && (
                <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                  {txCount}
                </span>
              )}
            </button>
          </Tooltip>
        )}

        <div className="mx-0.5 h-5 w-px bg-border/60" aria-hidden />

        <Tooltip content="Treiber" side="bottom">
          <Link
            to="/drivers"
            aria-label="Treiber"
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              section === "/drivers" && "bg-primary/12 text-foreground",
            )}
          >
            <PlugZap className="size-4" strokeWidth={1.75} />
          </Link>
        </Tooltip>

        <Tooltip content="AI-Arbeitsbereich" side="bottom">
          <button
            id="ai-workspace-trigger"
            type="button"
            aria-label="AI-Arbeitsbereich"
            aria-expanded={aiOpen || aiPage}
            aria-controls="ai-workspace"
            className={cn(
              "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              (aiOpen || aiPage) && "bg-primary/12 text-foreground",
            )}
            onClick={() => {
              if (aiPage) {
                setAiOpen(true);
                void navigate({ to: "/" });
              } else setAiOpen(!aiOpen);
            }}
          >
            <Sparkles className="size-4" strokeWidth={1.75} />
            {hasNewAiFeatures && !aiOpen && !aiPage ? (
              <NewBadge className="absolute -right-2 -top-1.5 px-1 text-[8px]" />
            ) : null}
          </button>
        </Tooltip>
        {!easyMode && (
          <Tooltip content="MCP" side="bottom">
            <Link
              to="/mcp"
              aria-label="MCP"
              className={cn(
                "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground",
                section === "/mcp" && "bg-primary/12 text-foreground",
              )}
            >
              <Bot className="size-4" strokeWidth={1.75} />
            </Link>
          </Tooltip>
        )}

        <Tooltip content="Einstellungen" side="bottom">
          <Link
            to="/settings"
            aria-label={hasNewSettingsFeatures ? "Einstellungen, neue Funktionen" : "Einstellungen"}
            className={cn(
              "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
              section === "/settings" && "bg-primary/12 text-foreground",
            )}
          >
            <Settings className="size-4" strokeWidth={1.75} />
            {hasNewSettingsFeatures ? (
              <NewBadge className="absolute -right-2 -top-1.5 px-1 text-[8px]" />
            ) : null}
            {update ? (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -left-0.5 size-2 rounded-full bg-red-500 ring-2 ring-card"
              />
            ) : null}
          </Link>
        </Tooltip>
      </nav>

      {USE_CUSTOM_WINDOW_CONTROLS ? <WindowControls /> : null}
    </header>
  );
}
