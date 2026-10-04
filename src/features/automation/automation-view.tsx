import { RotateCwIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { subscribeAutomationEvents, useAutomationStore } from "@/lib/automation/store";
import { useAutomationUiState } from "@/lib/automation/ui-state";
import { EASE_OUT } from "@/lib/ease";
import { AlertsView } from "./alerts-view";
import { AutomationEmptyState } from "./automation-empty-state";
import { AutomationToolbar } from "./automation-toolbar";
import { DeleteTasksDialog } from "./delete-tasks-dialog";
import { HistoryView } from "./history-view";
import { PlanningOverview } from "./planning-overview";
import { RunPromptDialog } from "./run-prompt-dialog";
import { AutomationSettingsView } from "./settings-view";
import { TaskEditor } from "./task-editor";
import { TaskList } from "./task-list";

export function AutomationView() {
  const view = useAutomationStore((state) => state.view);
  const loaded = useAutomationStore((state) => state.loaded);
  const error = useAutomationStore((state) => state.error);
  const count = useAutomationStore((state) => state.tasks.length);
  const selectedId = useAutomationStore((state) => state.selectedId);
  const draft = useAutomationStore((state) => state.draft);
  const draftKey = useAutomationStore((state) => state.draftKey);
  const load = useAutomationStore((state) => state.load);
  const select = useAutomationStore((state) => state.select);
  const upsertTask = useAutomationStore((state) => state.upsertTask);
  const listWidth = useAutomationUiState((state) => state.listWidth);
  const setListWidth = useAutomationUiState((state) => state.setListWidth);
  const width = useRef(listWidth);
  const reduce = useReducedMotion();

  useEffect(() => {
    void subscribeAutomationEvents().catch(() => undefined);
    void load();
  }, [load]);

  const editing = Boolean(selectedId || draft);
  const empty = loaded && !error && count === 0 && !draft;

  const tasksView = !loaded ? (
    <div className="flex h-full">
      <div className="flex shrink-0 flex-col gap-2 border-r p-3" style={{ width: listWidth }}>
        <Skeleton className="h-8 w-full rounded-lg" />
        {Array.from({ length: 6 }, (_, index) => index).map((index) => (
          <Skeleton key={index} className="h-10 w-full rounded-lg" />
        ))}
      </div>
      <div className="flex-1" />
    </div>
  ) : error && count === 0 ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium">Automatisierung ist nicht erreichbar</p>
      <p className="max-w-md text-xs text-pretty text-muted-foreground">{error}</p>
      <Button size="sm" variant="outline" onClick={() => void load()}>
        <RotateCwIcon />
        Erneut versuchen
      </Button>
    </div>
  ) : empty ? (
    <AutomationEmptyState />
  ) : (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full min-h-0"
      onLayoutChanged={() => setListWidth(width.current)}
    >
      <ResizablePanel
        id="automation-list"
        defaultSize={listWidth}
        minSize={240}
        maxSize={560}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size) => {
          width.current = size.inPixels;
        }}
        className="min-h-0 min-w-0"
      >
        <TaskList />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="automation-detail" className="min-h-0 min-w-0">
        {editing ? (
          <TaskEditor
            key={selectedId ?? `draft-${draftKey}`}
            taskId={selectedId}
            draft={selectedId ? undefined : (draft ?? undefined)}
            onSaved={(summary) => {
              upsertTask(summary);
              if (!selectedId) select(summary.task.id);
            }}
            onClose={() => select(null)}
          />
        ) : (
          <PlanningOverview />
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  return (
    <TooltipProvider delayDuration={350}>
      <div
        data-testid="automation-view"
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
      >
        <AutomationToolbar />
        <motion.div
          key={view}
          role="tabpanel"
          aria-label={
            { tasks: "Tasks", history: "Verlauf", alerts: "Alarme", settings: "Einstellungen" }[
              view
            ]
          }
          initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.16, ease: EASE_OUT }}
          className="min-h-0 flex-1"
        >
          {view === "tasks" && tasksView}
          {view === "history" && <HistoryView />}
          {view === "alerts" && <AlertsView />}
          {view === "settings" && <AutomationSettingsView />}
        </motion.div>
        <RunPromptDialog />
        <DeleteTasksDialog />
      </div>
    </TooltipProvider>
  );
}
