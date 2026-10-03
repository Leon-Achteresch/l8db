import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Server } from "lucide-react";
import { useState } from "react";
import { ThesvgIcon } from "@/components/provider-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import type { AiModels, AiProfile } from "@/lib/db/ai";
import { cn } from "@/lib/utils";
import { AiModelOptions } from "./ai-model-options";
import { aiProviderSvg } from "./ai-provider-icons";

function logo(id: string, className: string) {
  const svg = aiProviderSvg(id);
  return svg ? <ThesvgIcon svg={svg} className={className} /> : <Server className={className} />;
}

const GROUPS = [
  { label: "Lokale CLIs", cli: true },
  { label: "API-Schlüssel", cli: false },
];

interface Props {
  profile: AiProfile;
  models: AiModels;
  disabled: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
}
export function AiProviderPicker({ profile, models, disabled, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"provider" | "model">("provider");
  const profiles = useAiStore((state) => state.profiles);
  const provider = AI_PROVIDERS.find((entry) => entry.id === profile.provider);
  const model = models.models.find((entry) => entry.id === profile.model)?.name ?? profile.model;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setStep("provider");
      }}
    >
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
        className="w-72 max-w-[calc(100vw-32px)] gap-2 rounded-2xl p-2"
        aria-label="Anbieter und Modell"
      >
        {step === "provider" ? (
          <div role="radiogroup" aria-label="AI-Anbieter auswählen" className="space-y-2">
            {GROUPS.map((group) => (
              <div key={group.label} className="space-y-0.5">
                <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                {AI_PROVIDERS.filter((entry) => entry.cli === group.cli).map((entry) => {
                  const checked = entry.id === profile.id;
                  const entryModel = profiles.find((item) => item.id === entry.id)?.model;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      aria-label={entry.name}
                      disabled={disabled}
                      onClick={() => {
                        if (!checked) onSelect(entry.id);
                        setStep("model");
                      }}
                      className={cn(
                        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
                        checked && "bg-muted",
                      )}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border/70 bg-background">
                        {logo(entry.id, "size-3.5")}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate", checked && "font-medium")}>
                        {entry.name}
                      </span>
                      {entryModel && (
                        <span className="max-w-24 truncate text-[11px] text-muted-foreground">
                          {checked ? model : entryModel}
                        </span>
                      )}
                      {checked ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setStep("provider")}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-1 text-left text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
            >
              <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
              {logo(profile.provider, "size-3.5 shrink-0")}
              <span className="min-w-0 flex-1 truncate">{provider?.name}</span>
            </button>
            <div className="h-px bg-border/70" />
            {loading ? (
              <div className="flex h-20 items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Modelle werden geladen …
              </div>
            ) : (
              <AiModelOptions
                key={profile.id}
                profile={profile}
                models={models}
                disabled={disabled}
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
