import { createRootRoute } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { EasyModeOutlet } from "@/features/shell/easy-mode-outlet";
import { WindowCloseGuard } from "@/features/shell/window-close-guard";
import "../index.css";

import { DbThemeRoot } from "@/components/db-theme-root";
import { Toaster } from "@/components/ui/sonner";
import { PasswordPromptDialog } from "@/features/connections/password-prompt-dialog";
import { Onboarding } from "@/features/onboarding/onboarding";
import { SqlConfirmationDialog } from "@/features/query/sql-confirmation-dialog";
import { AppHeader } from "@/features/shell/app-header";
import { AppHotkeys } from "@/features/shell/app-hotkeys";
import { RouteErrorView } from "@/features/shell/route-error-view";
import { RouteNotFoundView } from "@/features/shell/route-not-found-view";
import { SqlFileDrop } from "@/features/shell/sql-file-drop";
import { TasksDialog } from "@/features/shell/tasks-dialog";
import { AppTour } from "@/features/tour/app-tour";
import { UpdateAvailableDialog } from "@/features/updates/update-available-dialog";

function RootComponent() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange>
        <DbThemeRoot className="h-dvh">
          <AppHotkeys />
          <SqlFileDrop />
          <AppHeader />
          <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
            <EasyModeOutlet />
          </div>
        </DbThemeRoot>
        <UpdateAvailableDialog />
        <PasswordPromptDialog />
        <SqlConfirmationDialog />
        <TasksDialog />
        <WindowCloseGuard />
        <AppTour />
        <Onboarding />
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
