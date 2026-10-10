import { Brain } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { modelEfforts, thoughtLevel } from "@/lib/ai/context";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import type { AiModels, AiProfile } from "@/lib/db/ai";

interface Props {
  profile: AiProfile;
  models: AiModels;
  disabled: boolean;
}
export function AiReasoningPicker({ profile, models, disabled }: Props) {
  const saveProfile = useAiStore((state) => state.saveProfile);
  const cli = Boolean(AI_PROVIDERS.find((entry) => entry.id === profile.provider)?.cli);
  const level = thoughtLevel(models);
  const efforts = level ? level.choices : modelEfforts(profile, models, cli);
  if (!efforts.length) return null;
  const current = level ? String(profile.config?.[level.id] ?? "") : profile.effort;
  const select = (effort: string) => {
    if (!level) {
      saveProfile({ ...profile, effort });
      return;
    }
    const { [level.id]: _, ...config } = profile.config ?? {};
    saveProfile({ ...profile, config: effort ? { ...config, [level.id]: effort } : config });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Reasoning auswählen"
          disabled={disabled}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <Brain className="size-3.5" />
          <span className="capitalize">{current || "Auto"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-40 rounded-2xl">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          Reasoning
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={select}>
          {["", ...efforts].map((effort) => (
            <DropdownMenuRadioItem key={effort} value={effort} className="text-xs capitalize">
              {effort || "Automatisch"}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
