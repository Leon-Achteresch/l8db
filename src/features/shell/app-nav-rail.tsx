import { Link } from "@tanstack/react-router";
import { Tooltip } from "@/components/motion/tooltip";
import { appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { useActiveCapabilities } from "@/lib/db-selection";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

function isNavActive(url: string, pathname: string) {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

export function AppNavRail() {
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const seenFeatures = useSeenNewFeatures();
  const navItems = appSidebarData.navMain.filter(
    (item) =>
      isEasyModeRouteVisible(item.url, easyMode) && (!item.available || item.available(caps)),
  );
  const activeUrl = useRouterSelect(
    (state) =>
      appSidebarData.navMain.find((item) => isNavActive(item.url, state.location.pathname))?.url,
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
