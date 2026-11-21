import { useAiEnabled } from "@/lib/ai/access";
import { useAiStore } from "@/lib/ai/store";
import { editorAiProfile, editorAiSupported } from "./client";
import { editorAiOn, useEditorAiSettings } from "./settings";

export function editorAiAvailable(): boolean {
  if (!editorAiOn()) return false;
  try {
    return editorAiSupported(editorAiProfile());
  } catch {
    return false;
  }
}

export function useEditorAiAvailable(): boolean {
  useAiEnabled();
  useEditorAiSettings((state) => state.enabled);
  useEditorAiSettings((state) => state.profileId);
  useAiStore((state) => state.profiles);
  useAiStore((state) => state.profileId);
  return editorAiAvailable();
}
