import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { ListPlusIcon, PlusIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { summarizeStep } from "@/lib/automation/step-summary";
import { type FlatStep, flattenSteps, moveStep } from "@/lib/automation/step-tree";
import type { ActionType, Step, ValidationIssue } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { StepAddMenu } from "./step-add-menu";
import { StepListItem } from "./step-list-item";

const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 4 })],
    preventActivation: () => false,
  }),
];

interface Props {
  steps: Step[];
  selectedId: string | null;
  issues: ValidationIssue[];
  onSelect: (id: string) => void;
  onChange: (steps: Step[]) => void;
  onAdd: (type: ActionType, parentId: string | null) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  connectionName: (ref: string) => string;
  taskName: (ref: string) => string;
}

function focusStep(id: string) {
  requestAnimationFrame(() =>
    document.querySelector<HTMLButtonElement>(`[data-step-button="${CSS.escape(id)}"]`)?.focus(),
  );
}

export function StepList({
  steps,
  selectedId,
  issues,
  onSelect,
  onChange,
  onAdd,
  onRemove,
  onDuplicate,
  connectionName,
  taskName,
}: Props) {
  const flat = useMemo(() => flattenSteps(steps), [steps]);
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const counts = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number }>();
    for (const issue of issues) {
      if (!issue.stepId) continue;
      const entry = map.get(issue.stepId) ?? { errors: 0, warnings: 0 };
      if (issue.severity === "error") entry.errors += 1;
      else entry.warnings += 1;
      map.set(issue.stepId, entry);
    }
    return map;
  }, [issues]);

  useEffect(() => {
    seen.current = new Set(flat.map((entry) => entry.step.id));
  }, [flat]);

  const move = (entry: FlatStep, delta: number) => {
    const to = entry.index + delta;
    if (to < 0 || to >= entry.siblings.length) return;
    onChange(moveStep(steps, entry.parentId, entry.index, to));
    setAnnouncement(
      `„${entry.step.name}“ ist jetzt Schritt ${to + 1} von ${entry.siblings.length}.`,
    );
    focusStep(entry.step.id);
  };

  const onKeyDown = (entry: FlatStep) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const position = flat.indexOf(entry);
    const mod = event.metaKey || event.ctrlKey;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(entry, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = flat[position + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        onSelect(next.step.id);
        focusStep(next.step.id);
      }
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? flat[0] : flat.at(-1);
      if (next) {
        onSelect(next.step.id);
        focusStep(next.step.id);
      }
    } else if ((event.key === "Delete" || event.key === "Backspace") && !mod) {
      event.preventDefault();
      const next = flat[position + 1] ?? flat[position - 1];
      onRemove(entry.step.id);
      if (next) focusStep(next.step.id);
    } else if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      onDuplicate(entry.step.id);
    }
  };

  const level = (items: Step[], parentId: string | null): ReactNode => {
    const group = parentId ?? "root";
    return (
      <ol
        className={cn(
          "flex flex-col gap-0.5",
          parentId && "mt-0.5 ml-[1.15rem] border-l border-dashed border-border pl-1.5",
        )}
      >
        {items.map((step) => {
          const entry = flat.find((item) => item.step.id === step.id);
          if (!entry) return null;
          const count = counts.get(step.id);
          const fresh = seen.current !== null && !seen.current.has(step.id);
          return (
            <StepListItem
              key={step.id}
              entry={entry}
              group={group}
              selected={selectedId === step.id}
              summary={summarizeStep(step, connectionName, taskName)}
              errors={count?.errors ?? 0}
              warnings={count?.warnings ?? 0}
              fresh={fresh}
              onSelect={() => onSelect(step.id)}
              onKeyDown={onKeyDown(entry)}
            >
              {step.action.type === "loop" && (
                <div className="pb-1">
                  {step.action.steps.length > 0 && level(step.action.steps, step.id)}
                  <div className="ml-[1.15rem] border-l border-dashed border-border pl-1.5">
                    <StepAddMenu onPick={(type) => onAdd(type, step.id)}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="my-0.5 ml-1 text-muted-foreground"
                      >
                        <PlusIcon />
                        Schritt in Schleife
                      </Button>
                    </StepAddMenu>
                  </div>
                </div>
              )}
            </StepListItem>
          );
        })}
      </ol>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-testid="automation-step-list"
        className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-3"
      >
        {steps.length === 0 ? (
          <div className="hidden flex-col items-start gap-3 px-3 py-6 @xl/editor:flex">
            <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
              <ListPlusIcon className="size-4" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Noch keine Schritte</p>
              <p className="text-xs text-pretty text-muted-foreground">
                Ein Task arbeitet seine Schritte der Reihe nach ab. Wähle den ersten aus dem
                Katalog.
              </p>
            </div>
          </div>
        ) : (
          <DragDropProvider
            sensors={sensors}
            onDragEnd={(event) => {
              const { operation, canceled } = event;
              if (canceled || !isSortable(operation.source)) return;
              const source = operation.source;
              if (source.initialGroup !== source.group || source.initialIndex === source.index)
                return;
              const parentId = source.group === "root" ? null : String(source.group);
              onChange(moveStep(steps, parentId, source.initialIndex, source.index));
            }}
          >
            {level(steps, null)}
          </DragDropProvider>
        )}
      </div>
      <div className="border-t px-2 py-2">
        <StepAddMenu onPick={(type) => onAdd(type, null)} side="top">
          <Button
            type="button"
            variant="ghost"
            data-testid="automation-add-step"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
          >
            <PlusIcon />
            Schritt hinzufügen
          </Button>
        </StepAddMenu>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
