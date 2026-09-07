import { createRootRoute, Outlet } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import "../index.css";

import { DbThemeRoot } from "@/components/db-theme-root";
import { Toaster } from "@/components/ui/sonner";
import { AppHeader } from "@/features/shell/app-header";
import { RouteErrorView } from "@/features/shell/route-error-view";
import { RouteNotFoundView } from "@/features/shell/route-not-found-view";
import { AppTour } from "@/features/tour/app-tour";
import { UpdateAvailableDialog } from "@/features/updates/update-available-dialog";

function RootComponent() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange>
        <DbThemeRoot className="h-dvh">
          <AppHeader />
          <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        </DbThemeRoot>
        <UpdateAvailableDialog />
        <AppTour />
        <Toaster />
      </ThemeProvider>
    </MotionConfig>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RouteErrorView,
  notFoundComponent: RouteNotFoundView,
});
