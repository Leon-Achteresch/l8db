import { AppSidebar } from "@/components/sidebar/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ConnectionsProvider } from "@/lib/connections";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";

export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAbout = pathname === "/about";
  const panelWidth = useSidebarPanel((state) => state.width);

  return (
    <ConnectionsProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": `calc(var(--sidebar-width-icon) + 1px + ${panelWidth}px)`,
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {isAbout ? (
                    <BreadcrumbLink asChild>
                      <Link to="/">Home</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Home</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {isAbout ? (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>About</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ConnectionsProvider>
  );
}
