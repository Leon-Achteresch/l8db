import { Link } from "@tanstack/react-router";
import { Plug } from "lucide-react";
import { Tooltip } from "@/components/motion/tooltip";
import { type AppSidebarNavItem, appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { useConnectionsStore } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

const connectItem: AppSidebarNavItem = { title: "Verbindungen", url: "/connections", icon: Plug };

function isNavActive(url: string, pathname: string) {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

export function AppNavRail() {
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const seenFeatures = useSeenNewFeatures();
  const hasConnections = useConnectionsStore((state) => state.connections.length > 0);
  const navItems = hasConnections
    ? appSidebarData.navMain.filter(
        (item) =>
          isEasyModeRouteVisible(item.url, easyMode) && (!item.available || item.available(caps)),
      )
    : [connectItem];
  const activeUrl = useRouterSelect(
    (state) =>
      [...appSidebarData.navMain, connectItem].find((item) =>
        isNavActive(item.url, state.location.pathname),
      )?.url,
  );

  return (
    <nav
      data-tour="header-nav"
      aria-label="Bereiche"
      className="flex w-14 shrink-0 flex-col items-center gap-1.5 overflow-y-auto bg-sidebar py-2 [scrollbar-width:none]"
    >
      {navItems.map((item) => {
        const active = item.url === activeUrl;
        return (
          <Tooltip key={item.title} content={item.title} side="right">
            <Link
              to={item.url}
              preload={item.url === "/query" || item.url === "/compare" ? false : "intent"}
              preloadDelay={80}
              aria-label={item.title}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors",
                "hover:bg-sidebar-accent hover:text-foreground",
                active && "bg-sidebar-accent text-foreground",
              )}
            >
              <item.icon className="size-[18px]" strokeWidth={2} />
              {hasNewFeatures(item.featureScope, seenFeatures) && (
                <span
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                  role="img"
                  aria-label="Neu"
                />
              )}
            </Link>
          </Tooltip>
        );
      })}
    </nav>
  );
}
