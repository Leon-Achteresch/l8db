import { Link } from "@tanstack/react-router";
import { Plug } from "lucide-react";
import { Tooltip } from "@/components/motion/tooltip";
import { type AppSidebarNavItem, appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { useActiveConnection } from "@/lib/connections";
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
  const activeConnection = useActiveConnection();
  const navItems = activeConnection
    ? appSidebarData.navMain.filter(
        (item) =>
          isEasyModeRouteVisible(item.url, easyMode) && (!item.available || item.available(caps)),
      )
    : [
        connectItem,
        ...appSidebarData.navMain.filter(
          (item) => item.connectionFree && isEasyModeRouteVisible(item.url, easyMode),
        ),
      ];
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
      className="app-nav-rail flex w-14 shrink-0 flex-col gap-1 overflow-y-auto bg-sidebar px-2 py-3 2xl:w-40 [scrollbar-width:none]"
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
                "relative inline-flex h-9 w-full shrink-0 items-center justify-center gap-2.5 rounded-md px-2 text-muted-foreground transition-colors 2xl:justify-start",
                "hover:bg-sidebar-accent hover:text-foreground",
                active && "bg-primary/10 text-primary",
              )}
            >
              <item.icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
              <span className="hidden truncate text-xs font-medium 2xl:block">{item.title}</span>
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
