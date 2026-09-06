import { Link, useRouterState } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { NavUser } from "@/features/sidebar/nav-user";
import { SPRING } from "@/lib/ease";

export function AppSidebarIconRail() {
  const reduce = useReducedMotion();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="none" className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
              <Link to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <img src="/logo.png" alt="l8db" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">l8db</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="px-1.5 md:px-0">
            <SidebarMenu>
              {appSidebarData.navMain.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={{ children: item.title, hidden: false }}
                    isActive={item.url === "/" ? pathname === "/" : pathname.startsWith(item.url)}
                    className="relative isolate px-2.5 md:px-2"
                  >
                    <Link
                      to={item.url}
                      aria-label={item.title}
                      aria-current={
                        (item.url === "/" ? pathname === "/" : pathname.startsWith(item.url))
                          ? "page"
                          : undefined
                      }
                    >
                      {(item.url === "/" ? pathname === "/" : pathname.startsWith(item.url)) && (
                        <motion.span
                          layoutId={reduce ? undefined : "sidebar-active"}
                          transition={SPRING}
                          className="absolute inset-0 -z-10 rounded-lg bg-primary/10 ring-1 ring-primary/10"
                        />
                      )}
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
