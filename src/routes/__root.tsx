import { createRootRoute } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense, startTransition, useEffect, useState } from "react";
import { WindowCloseGuard } from "@/features/shell/window-close-guard";
import { WorkbenchHost } from "@/features/shell/workbench-host";
import "../index.css";

import { DbThemeRoot } from "@/components/db-theme-root";
import { SpiderLayer } from "@/components/seasonal/spider-layer";
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
import { AppTourHost } from "@/features/tour/app-tour-host";
import { UpdateAvailableGate } from "@/features/updates/update-available-gate";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useTasksStore } from "@/lib/tasks";

const FeatureVideoHost = lazy(() =>
  import("@/features/updates/feature-video-host").then(({ FeatureVideoHost }) => ({
    default: FeatureVideoHost,
  })),
);

const BlogSuggestionHost = lazy(() =>
  import("@/features/updates/blog-suggestion-host").then(({ BlogSuggestionHost }) => ({
    default: BlogSuggestionHost,
  })),
);

const TasksDialog = lazy(() =>
  import("@/features/shell/tasks-dialog").then(({ TasksDialog }) => ({ default: TasksDialog })),
);

const AutoSyncHost = lazy(() =>
  import("@/features/shell/auto-sync-host").then(({ AutoSyncHost }) => ({
    default: AutoSyncHost,
  })),
);

function RootComponent() {
  const activeFeatureVideo = useFeatureVideoStore((state) => state.activeId);
  const tasksOpen = useTasksStore((state) => state.open);
  const [backgroundReady, setBackgroundReady] = useState(false);

  useEffect(() => {
    const activity = ["pointerdown", "keydown", "wheel", "scroll"] as const;
    let timer = 0;
    const deadline = window.setTimeout(ready, 10000);
    const stop = () => {
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      for (const type of activity) window.removeEventListener(type, wait, true);
    };
    function ready() {
      stop();
      startTransition(() => setBackgroundReady(true));
    }
    function wait() {
      window.clearTimeout(timer);
      timer = window.setTimeout(ready, 3000);
    }
    for (const type of activity)
      window.addEventListener(type, wait, { capture: true, passive: true });
    wait();
    return stop;
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
          <SpiderLayer />
        </DbThemeRoot>
        <UpdateAvailableGate />
        <PasswordPromptDialog />
        <SqlConfirmationDialog />
        {(backgroundReady || tasksOpen) && (
          <Suspense fallback={null}>
            <TasksDialog />
          </Suspense>
        )}
        <WindowCloseGuard />
        <AppTourHost />
        <OnboardingHost />
        {backgroundReady && (
          <Suspense fallback={null}>
            <AutoSyncHost />
          </Suspense>
        )}
        {(backgroundReady || activeFeatureVideo) && (
          <Suspense fallback={null}>
            <FeatureVideoHost />
          </Suspense>
        )}
        {backgroundReady && (
          <Suspense fallback={null}>
            <BlogSuggestionHost />
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
