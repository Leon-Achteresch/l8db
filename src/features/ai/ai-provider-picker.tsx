import { ChevronDown, Loader2, Server } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
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

const GROUPS = [true, false];

interface Props {
  profile: AiProfile;
  models: AiModels;
  disabled: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
}
export function AiProviderPicker({ profile, models, disabled, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState(1);
  const reduced = useReducedMotion();
  const index = AI_PROVIDERS.findIndex((entry) => entry.id === profile.id);
  const provider = AI_PROVIDERS[index];
  const model = models.models.find((entry) => entry.id === profile.model)?.name ?? profile.model;
  const offset = reduced ? 0 : 20;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Anbieter und Modell auswählen"
          title={`${provider?.name ?? ""}${model ? ` · ${model}` : ""}`}
          disabled={disabled}
          className="flex h-8 min-w-0 max-w-44 items-center gap-1.5 rounded-full pr-2 pl-1.5 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted"
        >
          <span className="grid size-5 shrink-0 place-items-center">
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
        className="flex w-[360px] max-w-[calc(100vw-32px)] flex-row gap-0 overflow-hidden rounded-2xl p-0"
        aria-label="Anbieter und Modell"
      >
        <div
          role="radiogroup"
          aria-label="AI-Anbieter auswählen"
          className="flex shrink-0 flex-col gap-2 bg-muted/40 p-1.5"
        >
          {GROUPS.map((cli) => (
            <div key={String(cli)} className="flex flex-col gap-0.5">
              {AI_PROVIDERS.filter((entry) => entry.cli === cli).map((entry) => {
                const checked = entry.id === profile.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={entry.name}
                    title={entry.name}
                    disabled={disabled}
                    onClick={() => {
                      if (checked) return;
                      setDirection(AI_PROVIDERS.indexOf(entry) > index ? 1 : -1);
                      onSelect(entry.id);
                    }}
                    className={cn(
                      "group relative grid size-8 place-items-center rounded-xl text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      checked && "text-foreground",
                    )}
                  >
                    {checked && (
                      <motion.span
                        layoutId="ai-provider-rail"
                        transition={{ type: "spring", stiffness: 550, damping: 38 }}
                        className="absolute inset-0 rounded-xl bg-background shadow-sm"
                      />
                    )}
                    <span className="relative transition-transform group-hover:scale-110 group-active:scale-90">
                      {logo(entry.id, "size-4")}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={profile.id}
              custom={direction}
              variants={{
                enter: (dir: number) => ({ y: dir * offset, opacity: 0, filter: "blur(4px)" }),
                center: { y: 0, opacity: 1, filter: "blur(0px)" },
                exit: (dir: number) => ({ y: dir * -offset, opacity: 0, filter: "blur(4px)" }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="space-y-1 p-2"
            >
              <div className="flex items-baseline justify-between gap-2 px-2 pt-1 pb-1.5">
                <span className="truncate text-[13px] font-semibold tracking-tight">
                  {provider?.name}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {provider?.cli ? "CLI" : "API"}
                </span>
              </div>
              {loading ? (
                <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Modelle werden geladen …
                </div>
              ) : (
                <AiModelOptions profile={profile} models={models} disabled={disabled} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </PopoverContent>
    </Popover>
  );
}
