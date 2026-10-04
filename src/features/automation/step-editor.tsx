import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  EllipsisIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { STEP_CATALOG, STEP_GROUP_TONE } from "@/lib/automation/step-catalog";
import type { FlatStep } from "@/lib/automation/step-tree";
import type { Step } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { StepActionForm } from "./step-action-form";
import { StepFlowFields } from "./step-flow-fields";

interface Props {
  entry: FlatStep;
  onChange: (step: Step) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onClose?: () => void;
}

export function StepEditor({ entry, onChange, onDuplicate, onRemove, onMove, onClose }: Props) {
  const { step, number, index, siblings } = entry;
  const catalog = STEP_CATALOG[step.action.type];
  const Icon = catalog.icon;
  const enabledId = useId();
  const risky = catalog.risky && (step.action.type !== "unzip" || step.action.overwrite);

  return (
    <div className="@container/step flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            STEP_GROUP_TONE[catalog.group],
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="tabular-nums">Schritt {number}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{catalog.label}</span>
          </span>
          <input
            value={step.name}
            onChange={(event) => onChange({ ...step, name: event.target.value })}
            placeholder={catalog.label}
            aria-label="Name des Schritts"
            className="-mx-1 min-w-0 text-ellipsis rounded-md bg-transparent px-1 text-[15px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        {risky && (
          <span className="hidden shrink-0 items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 @xl/step:inline-flex dark:text-amber-400">
            <TriangleAlertIcon className="size-3" aria-hidden />
            Verändert Daten/Dateien
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            id={enabledId}
            checked={step.enabled}
            onCheckedChange={(enabled) => onChange({ ...step, enabled })}
          />
          <label htmlFor={enabledId} className="text-xs text-muted-foreground select-none">
            {step.enabled ? "Aktiv" : "Übersprungen"}
          </label>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Schritt-Aktionen">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onDuplicate}>
              <CopyIcon />
              Duplizieren
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
              <ArrowUpIcon />
              Nach oben
              <DropdownMenuShortcut>⌥↑</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === siblings.length - 1} onSelect={() => onMove(1)}>
              <ArrowDownIcon />
              Nach unten
              <DropdownMenuShortcut>⌥↓</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2Icon />
              Löschen
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Schritt schließen"
            title="Schließen (Esc)"
            onClick={onClose}
            className="-mr-2"
          >
            <XIcon />
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          key={step.id}
          className="mx-auto flex max-w-3xl flex-col gap-8 px-5 pt-5 pb-16 animate-in duration-150 fade-in-0"
        >
          {risky && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-pretty text-amber-800 @xl/step:hidden dark:text-amber-300">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
              Verändert Daten/Dateien
            </p>
          )}
          <StepActionForm
            action={step.action}
            onChange={(action) => onChange({ ...step, action })}
          />
          <div className="border-t pt-6">
            <StepFlowFields step={step} onChange={onChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
