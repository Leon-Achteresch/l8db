import {
  CheckIcon,
  CircleAlertIcon,
  Loader2Icon,
  RotateCcwIcon,
  SettingsIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useAiStore } from "@/lib/ai/store";
import { FilterAiChangeRow } from "./filter-ai-change-row";
import type { FilterAi } from "./use-filter-ai";

export function FilterAiPanel({
  ai,
  sqlLabel,
  keyboard,
  onAccept,
}: {
  ai: FilterAi;
  sqlLabel: string;
  keyboard: boolean;
  onAccept: () => void;
}) {
  const { state } = ai;
  if (state.phase === "idle") return null;
  if (state.phase === "running") {
    return (
      <div role="status" className="flex min-w-0 items-center gap-2 text-sm">
        <Loader2Icon className="size-4 shrink-0 animate-spin text-violet-500" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          KI erstellt den Filter für „{state.prompt}“ …
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={ai.cancel}>
          Abbrechen
          {keyboard ? <Kbd>Esc</Kbd> : null}
        </Button>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div role="alert" className="grid gap-2">
        <div className="flex items-start gap-2 text-sm">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="min-w-0 break-words">{state.message}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => useAiStore.getState().setOpen(true)}
          >
            <SettingsIcon />
            KI-Anbieter einrichten
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void ai.run(state.prompt)}
          >
            <RotateCcwIcon />
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }
  const { proposal, changes, changed } = state;
  return (
    <div className="grid gap-2" aria-live="polite">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <SparklesIcon className="size-3.5 shrink-0 text-violet-500" />
        <span className="truncate">KI-Vorschlag für „{state.prompt}“</span>
      </div>
      {proposal.note ? <p className="text-sm">{proposal.note}</p> : null}
      {changes.length ? (
        <ul className="grid max-h-56 gap-1 overflow-y-auto">
          {changes.map((change) => (
            <FilterAiChangeRow
              key={`${change.kind}-${change.target}-${change.label}`}
              change={change}
              sqlLabel={sqlLabel}
            />
          ))}
        </ul>
      ) : null}
      {proposal.warnings.length ? (
        <ul className="grid gap-0.5 text-xs text-amber-700 dark:text-amber-400">
          {proposal.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {changed ? (
          <>
            <Button type="button" variant="ghost" size="xs" onClick={ai.cancel}>
              Verwerfen
              {keyboard ? <Kbd>Esc</Kbd> : null}
            </Button>
            <Button type="button" size="xs" onClick={onAccept}>
              <CheckIcon />
              Übernehmen
              {keyboard ? (
                <Kbd className="bg-primary-foreground/15 text-primary-foreground">↵</Kbd>
              ) : null}
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-xs text-muted-foreground">Keine Änderung nötig.</span>
            <Button type="button" variant="outline" size="xs" onClick={ai.cancel}>
              Schließen
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
