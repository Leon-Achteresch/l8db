import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  PlayIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ValidationIssue } from "@/lib/db/automation";
import { detectShortcutPlatform } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  enabled: boolean;
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  running: boolean;
  issues: ValidationIssue[];
  describeIssue: (issue: ValidationIssue) => string;
  onName: (name: string) => void;
  onEnabled: (enabled: boolean) => void;
  onIssue: (issue: ValidationIssue) => void;
  onRun: () => void;
  onSave: () => void;
  onClose: () => void;
}

const MOD = detectShortcutPlatform() === "mac" ? "⌘" : "Strg+";

export function TaskEditorHeader({
  name,
  enabled,
  isNew,
  dirty,
  saving,
  running,
  issues,
  describeIssue,
  onName,
  onEnabled,
  onIssue,
  onRun,
  onSave,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const switchId = useId();
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.length - errors.length;
  const blocked = errors.length > 0 && !enabled;
  const saved = !dirty && !isNew;

  return (
    <header className="flex flex-col gap-2 px-5 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="Name des Tasks"
          aria-label="Name des Tasks"
          aria-invalid={!name.trim() || undefined}
          className="-mx-1.5 min-w-0 flex-1 truncate rounded-lg bg-transparent px-1.5 py-0.5 text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {(dirty || isNew) && (
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground animate-in duration-150 fade-in-0">
            {isNew ? "Neu" : "Geändert"}
          </span>
        )}
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Editor schließen"
          onClick={onClose}
          className="-mr-1.5 shrink-0"
        >
          <XIcon />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={issues.length === 0}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default",
                errors.length
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
                  : warnings
                    ? "bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
                    : "text-muted-foreground",
              )}
            >
              {errors.length ? (
                <CircleAlertIcon className="size-3.5" aria-hidden />
              ) : warnings ? (
                <TriangleAlertIcon className="size-3.5" aria-hidden />
              ) : (
                <CircleCheckIcon
                  className="size-3.5 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  "tabular-nums",
                  issues.length === 0 && "sr-only @md/editor:not-sr-only",
                )}
              >
                {errors.length
                  ? `${errors.length} Fehler`
                  : warnings
                    ? `${warnings} ${warnings === 1 ? "Hinweis" : "Hinweise"}`
                    : "Bereit"}
              </span>
              {errors.length > 0 && warnings > 0 && (
                <span className="font-normal text-muted-foreground tabular-nums">
                  · {warnings} {warnings === 1 ? "Hinweis" : "Hinweise"}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 p-1">
            <ul className="flex max-h-80 flex-col overflow-y-auto">
              {[...issues]
                .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1))
                .map((issue, index) => (
                  <li key={`${issue.stepId}-${issue.field}-${index}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onIssue(issue);
                      }}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                    >
                      {issue.severity === "error" ? (
                        <CircleAlertIcon
                          className="mt-0.5 size-3.5 shrink-0 text-destructive"
                          aria-label="Fehler"
                        />
                      ) : (
                        <TriangleAlertIcon
                          className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-label="Hinweis"
                        />
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[13px] text-pretty">{issue.message}</span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {describeIssue(issue)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex h-8 items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted/60">
              <Switch
                id={switchId}
                checked={enabled}
                disabled={blocked}
                onCheckedChange={onEnabled}
              />
              <label htmlFor={switchId} className={cn("select-none", enabled && "text-foreground")}>
                {enabled ? "Aktiv" : "Pausiert"}
              </label>
            </div>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            {blocked
              ? "Erst die Fehler beheben, dann aktivieren."
              : enabled
                ? "Zeitpläne laufen. Ausschalten pausiert sie."
                : "Aktivieren, damit Zeitpläne laufen."}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="automation-run"
              className="ml-auto"
              aria-label={running ? "Läuft" : "Ausführen"}
              disabled={running || saving}
              onClick={onRun}
            >
              {running ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <PlayIcon className="fill-current" />
              )}
              <span className="hidden @md/editor:inline">{running ? "Läuft" : "Ausführen"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            {dirty ? "Speichert und führt aus" : "Jetzt ausführen"} · {MOD}↵
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant={saved ? "ghost" : "default"}
              data-testid="automation-save"
              disabled={saving || saved}
              onClick={onSave}
              className="@md/editor:min-w-24 disabled:opacity-100 data-[saved]:text-muted-foreground"
              data-saved={saved || undefined}
            >
              {saving ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                saved && <CheckIcon />
              )}
              {saving ? "Speichert …" : saved ? "Gespeichert" : "Speichern"}
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>{MOD}S</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
