import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDownIcon,
  FilePlus2Icon,
  FileUpIcon,
  LayoutTemplateIcon,
  PauseCircleIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { newTask } from "@/lib/automation/defaults";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import type { AutomationViewId } from "@/lib/automation/ui-state";
import { type ImportReport, importAutomationTasks } from "@/lib/db/automation";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";
import { ImportReportDialog } from "./import-report-dialog";
import { TemplatePickerDialog } from "./template-picker-dialog";
import { useAutomationSettings } from "./use-automation-settings";
import { useTaskActions } from "./use-task-actions";

const VIEWS: { id: AutomationViewId; label: string; scopes: string[] }[] = [
  {
    id: "tasks",
    label: "Tasks",
    scopes: ["automation.schedules", "automation.notifications"],
  },
  { id: "history", label: "Verlauf", scopes: ["automation.history"] },
  { id: "alerts", label: "Alarme", scopes: ["automation.alerts"] },
  { id: "settings", label: "Einstellungen", scopes: ["automation.background"] },
];

export function AutomationToolbar() {
  const view = useAutomationStore((state) => state.view);
  const setView = useAutomationStore((state) => state.setView);
  const openDraft = useAutomationStore((state) => state.openDraft);
  const load = useAutomationStore((state) => state.load);
  const tasks = useAutomationStore((state) => state.tasks);
  const selection = useAutomationStore((state) => state.selection);
  const triggered = useAutomationStore((state) =>
    state.tasks.reduce(
      (sum, task) => sum + task.alerts.filter((alert) => alert.status === "triggered").length,
      0,
    ),
  );
  const seen = useSeenNewFeatures();
  const reduce = useReducedMotion();
  const { settings, update } = useAutomationSettings();
  const { exportTasks } = useTaskActions();
  const newTaskBadge = useNewFeatureVisibility<HTMLButtonElement>("automation.tasks");
  const [templates, setTemplates] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const importTasks = async () => {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      const result = await importAutomationTasks(path);
      await load();
      setReport(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const exportIds = selection.length ? selection : tasks.map((task) => task.task.id);

  return (
    <header className="shrink-0 border-b">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <div
          role="tablist"
          aria-label="Ansicht"
          className="relative flex h-8 items-center gap-0.5 rounded-xl bg-muted p-0.5"
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            const index = VIEWS.findIndex((entry) => entry.id === view);
            const next =
              VIEWS[(index + (event.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length];
            event.preventDefault();
            setView(next.id);
            event.currentTarget.querySelector<HTMLElement>(`[data-view="${next.id}"]`)?.focus();
          }}
        >
          {VIEWS.map((entry) => {
            const active = view === entry.id;
            const isNew = entry.scopes.some((scope) => hasNewFeatures(scope, seen));
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-view={entry.id}
                onClick={() => setView(entry.id)}
                className={cn(
                  "relative isolate inline-flex h-7 items-center gap-1.5 rounded-[10px] px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={reduce ? undefined : "automation-view-pill"}
                    transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                    className="absolute inset-0 -z-10 rounded-[10px] bg-background shadow-sm ring-1 ring-border/60 dark:bg-input/40"
                  />
                )}
                {entry.label}
                {entry.id === "alerts" && triggered > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white dark:text-background">
                    <span className="sr-only">Ausgelöst: </span>
                    {triggered}
                  </span>
                )}
                {isNew && <NewBadge />}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            variant="ghost"
            size="icon-sm"
            aria-label="Tasks importieren"
            onClick={() => void importTasks()}
          >
            <FileUpIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-sm"
            aria-label={selection.length ? "Auswahl exportieren" : "Alle Tasks exportieren"}
            disabled={exportIds.length === 0}
            onClick={() => void exportTasks(exportIds)}
          >
            <UploadIcon />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={newTaskBadge.ref} size="sm" data-testid="automation-new-task">
                <PlusIcon />
                Neuer Task
                {newTaskBadge.isNew && <NewBadge className="bg-primary-foreground text-primary" />}
                <ChevronDownIcon className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => openDraft(newTask())}>
                <FilePlus2Icon />
                Leerer Task
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTemplates(true)}>
                <LayoutTemplateIcon />
                Aus Vorlage …
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {settings && !settings.schedulerEnabled && (
        <div
          role="status"
          className="flex items-center gap-2.5 border-t border-amber-500/20 bg-amber-500/8 px-4 py-1.5 text-xs text-amber-900 dark:text-amber-200"
        >
          <PauseCircleIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 text-pretty">
            <span className="font-semibold">Zeitpläne pausiert.</span> Tasks laufen nur, wenn du sie
            selbst startest.
          </span>
          <Button
            size="xs"
            variant="outline"
            className="border-amber-500/30 bg-transparent"
            onClick={() => void update({ schedulerEnabled: true })}
          >
            Fortsetzen
          </Button>
        </div>
      )}
      <TemplatePickerDialog open={templates} onOpenChange={setTemplates} />
      <ImportReportDialog report={report} onClose={() => setReport(null)} />
    </header>
  );
}
