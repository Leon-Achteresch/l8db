import { CornerDownLeftIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAiStore } from "@/lib/ai/store";
import { filterAiExamples } from "@/lib/filter-ai/examples";
import { filterAiAvailability } from "@/lib/filter-ai/run";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { FilterAiPanel } from "./filter-ai-panel";
import type { FilterAi } from "./use-filter-ai";
import type { FilterBarModel } from "./use-filter-bar-model";

export function FilterAiPopover({ ai, model }: { ai: FilterAi; model: FilterBarModel }) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("table.filter.ai");
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [availability, setAvailability] = useState(filterAiAvailability);
  const busy = ai.state.phase !== "idle";

  const close = () => {
    setOpen(false);
    setPrompt("");
  };
  const submit = (text = prompt) => {
    if (ai.state.phase === "running") return;
    if (ai.state.phase === "preview" && text.trim() === ai.state.prompt) {
      if (!ai.state.changed) ai.cancel();
      else if (ai.accept()) close();
      return;
    }
    void ai.run(text);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setAvailability(filterAiAvailability());
        else if (ai.state.phase !== "running") ai.cancel();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={feature.ref}
          type="button"
          variant="outline"
          size="xs"
          className={cn(
            "relative shrink-0 text-violet-600 dark:text-violet-300",
            busy && "border-violet-400/70",
          )}
          title="Filter und Farbregeln in eigenen Worten beschreiben"
        >
          <SparklesIcon />
          KI
          {feature.isNew ? <NewBadge className="absolute -top-1.5 -right-2" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(30rem,calc(100vw-2rem))] gap-3 p-3">
        <div
          className={cn(
            "rounded-lg p-px",
            ai.state.phase === "running"
              ? "animate-gradient bg-linear-to-r from-sky-400 via-violet-400 to-sky-400 bg-size-[300%_100%]"
              : "bg-input focus-within:bg-ring/70",
          )}
        >
          <div className="flex h-9 items-center gap-2 rounded-[calc(var(--radius-lg)-1px)] bg-background px-2">
            <SparklesIcon className="size-4 shrink-0 text-violet-500" />
            <input
              value={prompt}
              aria-label="KI-Anfrage für Filter und Farbregeln"
              placeholder={
                model.mode === "sql"
                  ? `Was soll der ${model.sqlLabel}-Filter zeigen?`
                  : "z. B. nur Fehler der letzten Woche, teure Zeilen gelb"
              }
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                submit();
              }}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Anfrage senden"
              disabled={!prompt.trim() || ai.state.phase === "running"}
              onClick={() => submit()}
            >
              <CornerDownLeftIcon />
            </Button>
          </div>
        </div>
        {busy ? (
          <FilterAiPanel
            ai={ai}
            sqlLabel={model.sqlLabel}
            keyboard={false}
            onAccept={() => {
              if (ai.accept()) close();
            }}
          />
        ) : availability.ok ? (
          <div className="grid gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {filterAiExamples(model.columns, model.columnDetails).map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setPrompt(example);
                    submit(example);
                  }}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-violet-400/60 hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {availability.label} sieht Spaltennamen, -typen, deine Anfrage und die aktiven Filter,
              aber keine Tabellenzeilen. Vor dem Übernehmen siehst du jede Änderung.
            </p>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{availability.reason}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => useAiStore.getState().setOpen(true)}
            >
              <SettingsIcon />
              Einrichten
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
