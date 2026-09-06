import { Outlet } from "@tanstack/react-router";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function PlainLayout() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/70 px-3 py-1 backdrop-blur-md">
        <SidebarTrigger className="-ml-1" />
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
