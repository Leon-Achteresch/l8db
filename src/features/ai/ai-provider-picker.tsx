import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AI_PROVIDERS } from "@/lib/ai/store";
import type { AiModels, AiProfile } from "@/lib/db/ai";
import { AiModelOptions } from "./ai-model-options";

interface Props {
  profile: AiProfile;
  models: AiModels;
  disabled: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
}
export function AiProviderPicker({ profile, models, disabled, loading, onSelect }: Props) {
  const provider = AI_PROVIDERS.find((entry) => entry.id === profile.provider);
  const model =
    models.models.find((entry) => entry.id === profile.model)?.name ??
    (profile.model || "Standard");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Anbieter und Modell auswählen"
          className="h-8 min-w-0 max-w-full justify-start gap-1.5 px-2 text-xs"
          disabled={disabled}
        >
          <span className="truncate font-medium">{provider?.name}</span>
          <span className="truncate text-muted-foreground">· {model}</span>
          {loading ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-32px)] gap-3 rounded-xl p-4"
        aria-label="Anbieter und Modell"
      >
        <label className="space-y-1.5 text-xs">
          <span className="font-medium">Anbieter</span>
          <select
            aria-label="AI-Anbieter auswählen"
            className="h-9 w-full rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={profile.id}
            disabled={disabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            {AI_PROVIDERS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <AiModelOptions key={profile.id} profile={profile} models={models} disabled={disabled} />
      </PopoverContent>
    </Popover>
  );
}
