import { createRootRoute, Outlet } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import "../index.css";

import { DbThemeRoot } from "@/components/db-theme-root";
import { Toaster } from "@/components/ui/sonner";
import { AppHeader } from "@/features/shell/app-header";

function RootComponent() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange>
        <DbThemeRoot className="h-dvh">
          <AppHeader />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        </DbThemeRoot>
        <Toaster />
      </ThemeProvider>
    </MotionConfig>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
