import { useSyncExternalStore } from "react";
import { getUpdatePromptState, subscribeUpdatePrompt, type UpdatePromptState } from "@/lib/updater";

export function useUpdatePrompt(): UpdatePromptState {
  return useSyncExternalStore(subscribeUpdatePrompt, getUpdatePromptState, getUpdatePromptState);
}
