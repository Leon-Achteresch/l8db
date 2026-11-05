import { Zap } from "lucide-react";
import { fastSupported } from "@/lib/ai/context";
import { useAiStore } from "@/lib/ai/store";
import type { AiModels, AiProfile } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

interface Props {
  profile: AiProfile;
  models: AiModels;
  disabled: boolean;
}
export function AiFastToggle({ profile, models, disabled }: Props) {
  const saveProfile = useAiStore((state) => state.saveProfile);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("ai.chat.fast-mode");
  if (!fastSupported(profile, models)) return null;
  const fast = Boolean(profile.fast);
  return (
    <button
      ref={feature.ref}
      type="button"
      aria-label="Fast-Modus"
      aria-pressed={fast}
      title={
        fast ? "Fast-Modus ausschalten" : "Fast-Modus einschalten: schneller, höherer Verbrauch"
      }
      disabled={disabled}
      onClick={() => saveProfile({ ...profile, fast: !fast })}
      className={cn(
        "relative flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        fast
          ? "text-amber-500 hover:text-amber-500"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Zap className={cn("size-3.5", fast && "fill-current")} />
      {fast && <span>Fast</span>}
      {feature.isNew && (
        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}
