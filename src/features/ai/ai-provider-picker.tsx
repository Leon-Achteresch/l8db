import { ChevronDown, Loader2, Server } from "lucide-react";
import { ThesvgIcon } from "@/components/provider-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AI_PROVIDERS } from "@/lib/ai/store";
import type { AiModels, AiProfile } from "@/lib/db/ai";
import { cn } from "@/lib/utils";
import { AiModelOptions } from "./ai-model-options";
import { aiProviderSvg } from "./ai-provider-icons";

function logo(id: string, className: string) {
  const svg = aiProviderSvg(id);
  return svg ? <ThesvgIcon svg={svg} className={className} /> : <Server className={className} />;
}

interface Props {
  profile: AiProfile;
  models: AiModels;
  disabled: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
}
export function AiProviderPicker({ profile, models, disabled, loading, onSelect }: Props) {
  const provider = AI_PROVIDERS.find((entry) => entry.id === profile.provider);
  const model = models.models.find((entry) => entry.id === profile.model)?.name ?? profile.model;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Anbieter und Modell auswählen"
          title={`${provider?.name ?? ""}${model ? ` · ${model}` : ""}`}
          disabled={disabled}
          className="flex h-8 min-w-0 max-w-40 items-center gap-1.5 rounded-full border border-border/70 bg-background pr-2 pl-1 text-xs shadow-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted">
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              logo(profile.provider, "size-3.5")
            )}
          </span>
          <span className="truncate font-medium">{model || provider?.name}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-32px)] gap-3 rounded-2xl p-3"
        aria-label="Anbieter und Modell"
      >
        <div role="radiogroup" aria-label="AI-Anbieter auswählen" className="flex flex-wrap gap-1">
          {AI_PROVIDERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={entry.id === profile.id}
              disabled={disabled}
              onClick={() => onSelect(entry.id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                entry.id === profile.id
                  ? "border-foreground/30 bg-muted font-medium text-foreground"
                  : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {logo(entry.id, "size-3.5")}
              {entry.name}
            </button>
          ))}
        </div>
        <AiModelOptions key={profile.id} profile={profile} models={models} disabled={disabled} />
      </PopoverContent>
    </Popover>
  );
}
