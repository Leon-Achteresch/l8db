import { Link } from "@tanstack/react-router";
import { Plug, PlugZap } from "lucide";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { Fragment } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import {
  type AppSidebarNavItem,
  appSidebarData,
  navGroupLabels,
} from "@/features/sidebar/app-sidebar-data";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

const connectItem: AppSidebarNavItem = {
  title: "Verbindungen",
  url: "/connections",
  icon: Plug,
  activeIcon: PlugZap,
};

function isNavActive(url: string, pathname: string) {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

const itemClass =
  "relative inline-flex shrink-0 items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground";

export function AppNavRail() {
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const expanded = useSettingsStore((state) => state.navRailExpanded);
  const setExpanded = useSettingsStore((state) => state.setNavRailExpanded);
  const toggleFeature = useNewFeatureVisibility<HTMLButtonElement>("workspace.nav-labels");
  const seenFeatures = useSeenNewFeatures();
  const activeConnection = useActiveConnection();
  const navItems = (
    activeConnection
      ? [
          connectItem,
          ...appSidebarData.navMain.filter(
            (item) =>
              isEasyModeRouteVisible(item.url, easyMode) &&
              (!item.available || item.available(caps)),
          ),
        ]
      : [
          connectItem,
          ...appSidebarData.navMain.filter(
            (item) => item.connectionFree && isEasyModeRouteVisible(item.url, easyMode),
          ),
        ]
  ).sort((a, b) => (a.group ?? 0) - (b.group ?? 0));
  const activeUrl = useRouterSelect(
    (state) =>
      [...appSidebarData.navMain, connectItem].find((item) =>
        isNavActive(item.url, state.location.pathname),
      )?.url,
  );
  const sizeClass = expanded
    ? "h-8 w-full justify-start gap-2.5 px-2.5 text-control"
    : "size-9 justify-center";
  const toggleLabel = expanded ? "Navigation einklappen" : "Navigation mit Beschriftung aufklappen";

  return (
    <nav
      data-tour="header-nav"
      data-expanded={expanded}
      aria-label="Bereiche"
      className={cn(
        "flex shrink-0 flex-col gap-1.5 overflow-y-auto bg-sidebar py-2 [scrollbar-width:none]",
        expanded ? "w-[184px] items-stretch gap-0.5 px-2" : "w-14 items-center",
      )}
    >
      {navItems.map((item, index) => {
        const active = item.url === activeUrl;
        const group = item.group ?? 0;
        const groupStart = index > 0 && (navItems[index - 1].group ?? 0) !== group;
        const link = (
          <Link
            to={item.url}
            preload={item.url === "/query" || item.url === "/compare" ? false : "intent"}
            preloadDelay={80}
            aria-label={item.title}
            aria-current={active ? "page" : undefined}
            className={cn(
              itemClass,
              sizeClass,
              active &&
                "bg-sidebar-accent font-medium text-foreground before:absolute before:inset-y-1.5 before:w-0.5 before:rounded-full before:bg-primary",
              active && (expanded ? "before:-left-2" : "before:-left-2.5"),
            )}
          >
            <MorphIcon
              icon={active ? item.activeIcon : item.icon}
              reducedMotion="user"
              className="size-4 shrink-0"
              strokeWidth={1.75}
            />
            {expanded && <span className="truncate">{item.title}</span>}
            {hasNewFeatures(item.featureScope, seenFeatures) && (
              <span
                className={cn(
                  "absolute size-1.5 rounded-full bg-primary",
                  expanded ? "right-2 top-1/2 -translate-y-1/2" : "right-1 top-1",
                )}
                role="img"
                aria-label="Neu"
              />
            )}
          </Link>
        );
        return (
          <Fragment key={item.title}>
            {groupStart && (
              <span
                aria-hidden="true"
                className={cn("my-1 h-px shrink-0 bg-border", expanded ? "w-full" : "w-6")}
              />
            )}
            {expanded && (index === 0 || groupStart) && navGroupLabels[group] && (
              <span className="px-2.5 pt-1 pb-0.5 text-xs text-muted-foreground">
                {navGroupLabels[group]}
              </span>
            )}
            {expanded ? (
              link
            ) : (
              <Tooltip content={item.title} side="right">
                {link}
              </Tooltip>
            )}
          </Fragment>
        );
      })}
      <button
        ref={toggleFeature.ref}
        type="button"
        aria-label={toggleLabel}
        aria-expanded={expanded}
        title={toggleLabel}
        onClick={() => setExpanded(!expanded)}
        className={cn(itemClass, sizeClass, "mt-auto")}
      >
        {expanded ? (
          <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.75} />
        ) : (
          <PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.75} />
        )}
        {expanded && <span className="truncate">Einklappen</span>}
        {toggleFeature.isNew && (
          <span
            className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
            role="img"
            aria-label="Neu"
          />
        )}
      </button>
    </nav>
  );
}
