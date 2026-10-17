import { lazy, Suspense, useRef } from "react";
import { StartupView } from "@/features/shell/startup-view";
import { useSettingsStore } from "@/lib/settings";
import { useTeamStore } from "@/lib/team/store";

const Onboarding = lazy(() =>
  import("@/features/onboarding/onboarding").then(({ Onboarding }) => ({ default: Onboarding })),
);

export function OnboardingHost() {
  const done = useSettingsStore((state) => state.onboardingDone);
  const teamPrompt = useTeamStore((state) => state.promptOpen);
  const shown = useRef(!done);
  if (!done) shown.current = true;
  if (!shown.current) return null;
  return (
    <div hidden={teamPrompt}>
      <Suspense
        fallback={
          <div className="fixed inset-0 z-[10000002] bg-background">
            <StartupView />
          </div>
        }
      >
        <Onboarding />
      </Suspense>
    </div>
  );
}
