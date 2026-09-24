import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Tooltip } from "@/components/motion/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { useActiveCapabilities } from "@/lib/db-selection";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

function isNavActive(url: string, pathname: string) {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

export function AppHeaderNavigation() {
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
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
      className="flex shrink-0 items-center gap-1 px-3"
      aria-label="Bereiche"
    >
      <Link
        to="/"
        className="mr-1 inline-flex h-7 shrink-0 items-center px-1 text-sm font-semibold tracking-tight"
      >
        l8db
      </Link>
      <div className="hidden items-center gap-1 @min-[54rem]:flex">
        {navItems.map((item) => {
          const active = item.url === activeUrl;
          return (
            <Tooltip key={item.title} content={item.title} side="bottom">
              <Link
                to={item.url}
                aria-label={item.title}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-foreground",
                  active && "bg-primary/12 text-foreground hover:bg-primary/12",
                )}
              >
                <item.icon className="size-4" strokeWidth={2} />
              </Link>
            </Tooltip>
          );
        })}
      </div>
      <div className="@min-[54rem]:hidden">
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
                <Link to={item.url} aria-current={item.url === activeUrl ? "page" : undefined}>
                  <item.icon className="size-4" />
                  {item.title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
