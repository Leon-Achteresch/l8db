import { Link } from "@tanstack/react-router";
import { ChevronRight, Menu, Plug } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AppSidebarNavItem, appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

const COLLAPSIBLE_URLS = new Set([
  "/notebook",
  "/monitor",
  "/er-diagram",
  "/saved-plan",
  "/query-builder",
]);

const connectItem: AppSidebarNavItem = { title: "Verbindungen", url: "/connections", icon: Plug };

function isNavActive(url: string, pathname: string) {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

export function AppHeaderNavigation() {
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const seenFeatures = useSeenNewFeatures();
  const activeConnection = useActiveConnection();
  const navItems = activeConnection
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

  const [expanded, setExpanded] = useState(false);
  const primaryItems = navItems.filter((item) => !COLLAPSIBLE_URLS.has(item.url));
  const extraItems = navItems.filter((item) => COLLAPSIBLE_URLS.has(item.url));

  const renderItem = (item: (typeof navItems)[number]) => {
    const active = item.url === activeUrl;
    return (
      <Tooltip key={item.title} content={item.title} side="bottom">
        <Link
          to={item.url}
          preload={item.url === "/query" || item.url === "/compare" ? false : "intent"}
          preloadDelay={80}
          aria-label={item.title}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
            "hover:bg-muted hover:text-foreground",
            active && "bg-primary/12 text-foreground hover:bg-primary/12",
          )}
        >
          <item.icon className="size-4" strokeWidth={2} />
          {hasNewFeatures(item.featureScope, seenFeatures) && (
            <span
              className="absolute right-0 top-0 size-1.5 rounded-full bg-primary"
              role="img"
              aria-label="Neu"
            />
          )}
        </Link>
      </Tooltip>
    );
  };

  return (
    <nav
      data-tour="header-nav"
      className="flex shrink-0 items-center gap-1 px-3"
      aria-label="Bereiche"
    >
      <Link
        to="/"
        className="mr-1 inline-flex h-7 shrink-0 items-center px-1 text-sm font-semibold tracking-tight"
      >
        l8db
      </Link>
      <div
        className={cn("items-center gap-1", activeConnection ? "hidden @min-[54rem]:flex" : "flex")}
      >
        {primaryItems.map(renderItem)}
        <AnimatePresence initial={false}>
          {expanded && extraItems.length > 0 && (
            <motion.div
              key="extra"
              className="flex items-center gap-1 overflow-hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {extraItems.map(renderItem)}
            </motion.div>
          )}
        </AnimatePresence>
        {extraItems.length > 0 && (
          <Tooltip content={expanded ? "Weniger anzeigen" : "Mehr anzeigen"} side="bottom">
            <button
              type="button"
              aria-label={expanded ? "Weniger anzeigen" : "Mehr anzeigen"}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <motion.span
                className="inline-flex"
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <ChevronRight className="size-4" strokeWidth={2} />
              </motion.span>
            </button>
          </Tooltip>
        )}
      </div>
      <div className={cn("@min-[54rem]:hidden", !activeConnection && "hidden")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Bereiche öffnen"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Menu className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {navItems.map((item) => (
              <DropdownMenuItem key={item.url} asChild>
                <Link
                  to={item.url}
                  preload={item.url === "/query" || item.url === "/compare" ? false : "intent"}
                  preloadDelay={80}
                  aria-current={item.url === activeUrl ? "page" : undefined}
                >
                  <item.icon className="size-4" />
                  {item.title}
                  {hasNewFeatures(item.featureScope, seenFeatures) && (
                    <span
                      className="ml-auto size-1.5 rounded-full bg-primary"
                      role="img"
                      aria-label="Neu"
                    />
                  )}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
