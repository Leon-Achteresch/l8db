import { useEffect, useState } from "react";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import { type AiProfile, type AiStatus, aiStatus } from "@/lib/db/ai";

export function aiReady(profile: AiProfile, status: AiStatus | null): boolean {
  if (!status) return false;
  if (AI_PROVIDERS.find((entry) => entry.id === profile.provider)?.cli) return status.installed;
  return status.keyStored || (profile.provider === "compatible" && Boolean(profile.endpoint));
}

export function useAiSetupNeeded(active: boolean) {
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const { profiles } = useAiStore.getState();
    void Promise.all(
      profiles.map((profile) =>
        aiStatus(profile)
          .then((status) => aiReady(profile, status))
          .catch(() => false),
      ),
    ).then((ready) => {
      if (live) setNeeded(!ready.some(Boolean));
    });
    return () => {
      live = false;
    };
  }, [active]);
  return [needed, setNeeded] as const;
}
