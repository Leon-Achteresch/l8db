import { createRootRoute, Outlet } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import "../index.css";

import { Toaster } from "@/components/ui/sonner";
import { AppHeader } from "@/features/shell/app-header";

function RootComponent() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange>
        <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
          <AppHeader />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        </div>
        <Toaster />
      </ThemeProvider>
    </MotionConfig>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
