import { createRootRoute, Outlet } from "@tanstack/react-router";
import "../index.css";

import { AppHeader } from "@/components/app-header";

function RootComponent() {
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <AppHeader />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
