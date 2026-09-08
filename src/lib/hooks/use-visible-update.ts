import type { Update } from "@tauri-apps/plugin-updater";
import { useSettingsStore } from "@/lib/settings";
import { useUpdatePrompt } from "@/lib/hooks/use-update-prompt";

export function useVisibleUpdate(): Update | null {
  const { update } = useUpdatePrompt();
  const skippedUpdateVersion = useSettingsStore((s) => s.skippedUpdateVersion);
  if (!update) return null;
  if (skippedUpdateVersion && update.version === skippedUpdateVersion) return null;
  return update;
}
