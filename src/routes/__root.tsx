import { createRootRoute } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense, startTransition, useEffect, useState } from "react";
import { WindowCloseGuard } from "@/features/shell/window-close-guard";
import { WorkbenchHost } from "@/features/shell/workbench-host";
import "../index.css";
import "../styles/workspace.css";

import { DbThemeRoot } from "@/components/db-theme-root";
import { Toaster } from "@/components/ui/sonner";
import { PasswordPromptDialog } from "@/features/connections/password-prompt-dialog";
import { OnboardingHost } from "@/features/onboarding/onboarding-host";
import { SqlConfirmationDialog } from "@/features/query/sql-confirmation-dialog";
import { AppFrame } from "@/features/shell/app-frame";
import { AppHeader } from "@/features/shell/app-header";
import { AppHotkeys } from "@/features/shell/app-hotkeys";
import { RouteErrorView } from "@/features/shell/route-error-view";
import { RouteNotFoundView } from "@/features/shell/route-not-found-view";
import { SqlFileDrop } from "@/features/shell/sql-file-drop";
import { TasksDialog } from "@/features/shell/tasks-dialog";
import { AppTourHost } from "@/features/tour/app-tour-host";
import { UpdateAvailableDialog } from "@/features/updates/update-available-dialog";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";

const FeatureVideoHost = lazy(() =>
  import("@/features/updates/feature-video-host").then(({ FeatureVideoHost }) => ({
    default: FeatureVideoHost,
  })),
);

function RootComponent() {
  const activeFeatureVideo = useFeatureVideoStore((state) => state.activeId);
  const [backgroundReady, setBackgroundReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => startTransition(() => setBackgroundReady(true)), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange>
        <DbThemeRoot className="h-dvh">
          <WorkbenchHost />
          <AppHotkeys />
          <SqlFileDrop />
          <AppHeader />
          <AppFrame />
        </DbThemeRoot>
        <UpdateAvailableDialog />
        <PasswordPromptDialog />
        <SqlConfirmationDialog />
        <TasksDialog />
        <WindowCloseGuard />
        <AppTourHost />
        <OnboardingHost />
        {(backgroundReady || activeFeatureVideo) && (
          <Suspense fallback={null}>
            <FeatureVideoHost />
          </Suspense>
        )}
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
