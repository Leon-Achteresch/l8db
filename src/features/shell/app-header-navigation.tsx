import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { motion } from "motion/react";
import { Tooltip } from "@/components/motion/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

function isNavActive(url: string, pathname: string) {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

export function AppHeaderNavigation({ pathname }: { pathname: string }) {
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
        {appSidebarData.navMain.map((item) => {
          const active = isNavActive(item.url, pathname);
          return (
            <Tooltip key={item.title} content={item.title} side="bottom">
              <motion.div
                layout="position"
                transition={{ layout: SPRING_LAYOUT }}
                className="relative"
              >
                {active && (
                  <motion.span
                    layoutId="header-nav-active"
                    transition={SPRING_LAYOUT}
                    className="absolute inset-0 rounded-full bg-primary/12"
                  />
                )}
                <Link
                  to={item.url}
                  aria-label={item.title}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
                    "hover:bg-muted hover:text-foreground",
                    active && "text-foreground",
                  )}
                >
                  <item.icon className="size-4" strokeWidth={2} />
                </Link>
              </motion.div>
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
            {appSidebarData.navMain.map((item) => (
              <DropdownMenuItem key={item.url} asChild>
                <Link
                  to={item.url}
                  aria-current={isNavActive(item.url, pathname) ? "page" : undefined}
                >
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
