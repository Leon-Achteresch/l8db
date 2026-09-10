import { Link, useRouterState } from "@tanstack/react-router";
import {
  Database,
  GitBranchIcon,
  Home,
  Settings,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type CSSProperties } from "react";

import { AppHeaderSearch } from "@/components/app-header-search";
import { useTransactionStore } from "@/lib/transactions";
import { cn } from "@/lib/utils";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

const IS_WINDOWS =
  typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

type NavItem = {
  to: "/" | "/connections" | "/about";
  label: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/connections", label: "Verbindungen", icon: Database },
  { to: "/about", label: "Über", icon: User },
];

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const txCount = useTransactionStore((s) => s.transactions.length);
  const panelOpen = useTransactionStore((s) => s.panelOpen);
  const togglePanel = useTransactionStore((s) => s.togglePanel);
  const syncWithBackend = useTransactionStore((s) => s.syncWithBackend);

  useEffect(() => {
    syncWithBackend();
  }, [syncWithBackend]);

  return (
    <header
      data-tauri-drag-region
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
      className={cn(
        "relative z-20 flex h-[var(--app-header-height)] shrink-0 select-none items-center gap-0",
        "border-b border-border/50",
        "bg-card/85 backdrop-blur-xl backdrop-saturate-150 dark:bg-background/70",
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
        className="flex items-center gap-px px-1"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        aria-label="Hauptnavigation"
      >
        <button
          type="button"
          onClick={togglePanel}
          aria-label="Transaktionen"
          title="Transaktionen"
          className={cn(
            "relative inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-all duration-150 cursor-pointer",
            "hover:bg-muted hover:text-foreground",
            panelOpen && "bg-muted text-foreground",
          )}
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <GitBranchIcon className="size-4" strokeWidth={2} />
          {txCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
              {txCount}
            </span>
          )}
        </button>

        <div className="mx-0.5 h-4 w-px bg-border/60" aria-hidden />

        <Link
          to="/settings"
          aria-label="Einstellungen"
          title="Einstellungen"
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-all duration-150",
            "hover:bg-muted hover:text-foreground",
            pathname.startsWith("/settings") && "bg-muted text-foreground",
          )}
        >
          <Settings className="size-4" strokeWidth={2} />
        </Link>
      </nav>
    </header>
  );
}
