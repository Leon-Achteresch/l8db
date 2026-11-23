import { requestAiConsent, useAiAccess } from "@/lib/ai/access";
import { editorAiConsentProfile } from "@/lib/ai/editor/client";
import { useEditorAiSettings } from "@/lib/ai/editor/settings";
import { useAiStore } from "@/lib/ai/store";

export function EditorAiConsentChip() {
  useAiAccess((state) => state.enabled);
  useAiAccess((state) => state.consent);
  useEditorAiSettings((state) => state.enabled && (state.inline || state.codeLens));
  useEditorAiSettings((state) => state.profileId);
  useAiStore((state) => state.profiles);
  useAiStore((state) => state.profileId);
  const profile = editorAiConsentProfile();
  if (!profile) return null;
  return (
    <button
      type="button"
      onClick={() => void requestAiConsent(profile)}
      title="KI-Anbieter freigeben"
      className="-mx-1.5 flex cursor-pointer items-center gap-1.5 rounded-full px-1.5 py-0.5 whitespace-nowrap text-foreground transition-colors hover:bg-muted"
    >
      <span className="size-1.5 rounded-full bg-amber-500" />
      KI: Freigabe
    </button>
  );
}
