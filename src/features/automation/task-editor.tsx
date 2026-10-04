import { HistoryIcon, ListTreeIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cloneStep, newStep } from "@/lib/automation/defaults";
import { placeholderSuggestions } from "@/lib/automation/placeholders";
import type { GraphInsert } from "@/lib/automation/step-graph";
import {
  type FlatStep,
  flattenSteps,
  insertStep,
  moveStep,
  removeStep,
  updateStep,
} from "@/lib/automation/step-tree";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import { useAutomationUiState } from "@/lib/automation/ui-state";
import { useConnectionsStore } from "@/lib/connections/store";
import type { ActionType, Step, Task, TaskSummary, ValidationIssue } from "@/lib/db/automation";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { NotificationsTab } from "./notifications-tab";
import { ScheduleTab } from "./schedule-tab";
import { StepAddMenu } from "./step-add-menu";
import { StepCatalogGrid } from "./step-catalog-grid";
import { StepEditor } from "./step-editor";
import { StepFormContext, type StepFormContextValue } from "./step-form-context";
import { StepGraphView } from "./step-graph-view";
import { StepList } from "./step-list";
import { StepViewSwitch } from "./step-view-switch";
import { TaskEditorHeader } from "./task-editor-header";
import { TaskGeneralTab } from "./task-general-tab";
import { TaskRunBar } from "./task-run-bar";
import { useAutomationSettings } from "./use-automation-settings";
import { useTaskDraft } from "./use-task-draft";
import { VariablesTab } from "./variables-tab";

export type TaskEditorProps = {
  taskId: string | null;
  draft?: Task;
  onSaved(summary: TaskSummary): void;
  onClose(): void;
};

type TabId = "steps" | "schedule" | "variables" | "notifications" | "settings";

function tabFor(issue: ValidationIssue): TabId {
  if (issue.stepId || issue.field === "steps") return "steps";
  if (issue.field.startsWith("schedules.")) return "schedule";
  if (
    issue.field.startsWith("variables.") ||
    issue.field.startsWith("environments.") ||
    issue.field === "defaultEnvironment"
  )
    return "variables";
  if (issue.field.startsWith("notifications.")) return "notifications";
  return "settings";
}

const TAB_LABELS: Record<TabId, string> = {
  steps: "Schritte",
  schedule: "Zeitplan",
  variables: "Variablen",
  notifications: "Benachrichtigungen",
  settings: "Einstellungen",
};

function loopItems(flat: FlatStep[], entry: FlatStep | null): string[] {
  const byId = new Map(flat.map((item) => [item.step.id, item]));
  const items: string[] = [];
  if (entry?.step.action.type === "loop") items.push(entry.step.action.item);
  let parent = entry?.parentId ? byId.get(entry.parentId) : undefined;
  while (parent) {
    if (parent.step.action.type === "loop") items.unshift(parent.step.action.item);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return items;
}

export function TaskEditor({ taskId, draft, onSaved, onClose }: TaskEditorProps) {
  const editor = useTaskDraft({ taskId, draft, onSaved });
  const { task, patch, setTask, issues, errors, dirty, isNew, saving, save } = editor;
  const tasks = useAutomationStore((state) => state.tasks);
  const requestRun = useAutomationStore((state) => state.requestRun);
  const activeRun = useAutomationStore((state) =>
    task
      ? Object.values(state.activeRuns).find((run) => run.summary.taskId === task.id)
      : undefined,
  );
  const connections = useConnectionsStore((state) => state.connections);
  const { settings } = useAutomationSettings();
  const schedulesFeature = useNewFeatureVisibility<HTMLDivElement>("automation.schedules");
  const notificationsFeature = useNewFeatureVisibility<HTMLDivElement>("automation.notifications");
  const [tab, setTab] = useState<TabId>("steps");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const stepView = useAutomationUiState((state) => state.stepView);
  const size = useElementSize<HTMLDivElement>();
  const narrow = size.width > 0 && size.width < 768;
  const graphMode = stepView === "graph" && !narrow;

  const steps = task?.steps ?? [];
  const flat = useMemo(() => flattenSteps(steps), [steps]);
  const picked = flat.find((entry) => entry.step.id === selectedId) ?? null;
  const selected = graphMode ? picked : (picked ?? flat[0] ?? null);

  const connectionName = useCallback(
    (ref: string) => connections.find((connection) => connection.id === ref)?.name ?? ref,
    [connections],
  );
  const taskName = useCallback(
    (ref: string) => tasks.find((entry) => entry.task.id === ref)?.task.name ?? ref,
    [tasks],
  );
  const taskNames = useMemo(
    () => Object.fromEntries(tasks.map((entry) => [entry.task.id, entry.task.name])),
    [tasks],
  );

  const environmentKeys = useMemo(
    () => [...new Set((task?.environments ?? []).flatMap((env) => Object.keys(env.variables)))],
    [task?.environments],
  );
  const topLevel = useMemo(() => steps.map((step) => ({ id: step.id, name: step.name })), [steps]);

  const context = useCallback(
    (entry: FlatStep | null): StepFormContextValue | null => {
      if (!task) return null;
      const items = loopItems(flat, entry);
      return {
        task,
        stepId: entry?.step.id ?? null,
        issues,
        suggestions: placeholderSuggestions(task.variables, environmentKeys, items, topLevel),
        items,
        siblings: entry?.siblings ?? task.steps,
        settings: settings ?? null,
        tasks,
      };
    },
    [task, flat, issues, environmentKeys, topLevel, settings, tasks],
  );
  const stepContext = useMemo(() => context(selected), [context, selected]);
  const taskContext = useMemo(() => context(null), [context]);

  const setSteps = useCallback(
    (next: Step[] | ((current: Step[]) => Step[])) =>
      setTask((current) =>
        current
          ? { ...current, steps: typeof next === "function" ? next(current.steps) : next }
          : current,
      ),
    [setTask],
  );

  const addStep = (type: ActionType, parentId: string | null) => {
    const step = newStep(type);
    if (parentId) {
      const loop = flat.find((entry) => entry.step.id === parentId);
      const length = loop?.step.action.type === "loop" ? loop.step.action.steps.length : 0;
      setSteps((current) => insertStep(current, parentId, length, step));
    } else {
      let anchor: FlatStep | null = selected;
      while (anchor?.parentId) {
        const parent: string = anchor.parentId;
        anchor = flat.find((entry) => entry.step.id === parent) ?? null;
      }
      setSteps((current) =>
        insertStep(current, null, anchor ? anchor.index + 1 : current.length, step),
      );
    }
    setSelectedId(step.id);
    setTab("steps");
  };

  const insertAt = useCallback(
    (insert: GraphInsert, type: ActionType) => {
      const step = newStep(type);
      setSteps((current) => insertStep(current, insert.parentId, insert.index, step));
      setSelectedId(step.id);
    },
    [setSteps],
  );

  const removeSelected = (id: string) => {
    const previous = steps;
    const entry = flat.find((item) => item.step.id === id);
    const position = flat.findIndex((item) => item.step.id === id);
    setSteps(removeStep(previous, id));
    const next =
      flat.slice(position + 1).find((item) => item.parentId === entry?.parentId) ??
      flat[position - 1];
    const fallback = next && next.step.id !== id ? next.step.id : null;
    setSelectedId((current) => (graphMode && current !== id ? current : fallback));
    toast(`„${entry?.step.name || "Schritt"}“ gelöscht`, {
      action: {
        label: "Rückgängig",
        onClick: () => {
          setSteps(previous);
          setSelectedId(id);
        },
      },
    });
  };

  const duplicate = (id: string) => {
    const entry = flat.find((item) => item.step.id === id);
    if (!entry) return;
    const copy = cloneStep(entry.step);
    setSteps((current) => insertStep(current, entry.parentId, entry.index + 1, copy));
    setSelectedId(copy.id);
  };

  const move = (entry: FlatStep, delta: number) =>
    setSteps((current) => moveStep(current, entry.parentId, entry.index, entry.index + delta));

  const run = useCallback(async () => {
    if (!task || requesting) return;
    setRequesting(true);
    try {
      const summary =
        dirty || isNew
          ? await save()
          : (tasks.find((entry) => entry.task.id === task.id) ?? (await save()));
      if (summary) await requestRun(summary);
    } catch (error) {
      toast.error("Start fehlgeschlagen", { description: String(error) });
    } finally {
      setRequesting(false);
    }
  }, [task, requesting, dirty, isNew, save, tasks, requestRun]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!saving) void save();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void run();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save, run, saving]);

  const describeIssue = (issue: ValidationIssue) => {
    if (issue.stepId) {
      const entry = flat.find((item) => item.step.id === issue.stepId);
      return entry ? `Schritt ${entry.number} · ${entry.step.name}` : "Schritt";
    }
    return TAB_LABELS[tabFor(issue)];
  };

  const openIssue = (issue: ValidationIssue) => {
    setTab(tabFor(issue));
    if (issue.stepId) setSelectedId(issue.stepId);
  };

  const stepEditor = (entry: FlatStep, onClose?: () => void) =>
    stepContext && (
      <StepFormContext.Provider value={stepContext}>
        <StepEditor
          key={entry.step.id}
          entry={entry}
          onChange={(step) => setSteps((current) => updateStep(current, step.id, () => step))}
          onDuplicate={() => duplicate(entry.step.id)}
          onRemove={() => removeSelected(entry.step.id)}
          onMove={(delta) => move(entry, delta)}
          onClose={onClose}
        />
      </StepFormContext.Provider>
    );

  if (!task) {
    return editor.loadError ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">Task konnte nicht geladen werden</p>
        <p className="max-w-md text-xs text-pretty text-muted-foreground">{editor.loadError}</p>
        <Button size="sm" variant="outline" onClick={onClose}>
          Schließen
        </Button>
      </div>
    ) : (
      <div className="flex h-full flex-col gap-4 p-5">
        <Skeleton className="h-7 w-64 rounded-lg" />
        <Skeleton className="h-8 w-96 rounded-lg" />
        <div className="flex flex-1 gap-4">
          <Skeleton className="h-full w-72 rounded-xl" />
          <Skeleton className="h-full flex-1 rounded-xl" />
        </div>
      </div>
    );
  }

  const stepCount = flat.length;
  const errorTabs = new Set(errors.map(tabFor));
  const running = Boolean(activeRun) || requesting;

  return (
    <div
      ref={size.ref}
      data-testid="automation-task-editor"
      className="@container/editor flex h-full min-h-0 flex-col bg-background"
    >
      <TaskEditorHeader
        name={task.name}
        enabled={task.enabled}
        isNew={isNew}
        dirty={dirty}
        saving={saving}
        running={running}
        issues={issues}
        describeIssue={describeIssue}
        onName={(name) => patch({ name })}
        onEnabled={(enabled) => patch({ enabled })}
        onIssue={openIssue}
        onRun={() => void run()}
        onSave={() => void save()}
        onClose={onClose}
      />
      {editor.restored && (
        <div className="mx-5 mb-2 flex items-center gap-3 rounded-lg bg-primary/8 px-3 py-2 text-xs animate-in duration-200 fade-in-0">
          <HistoryIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="flex-1">Nicht gespeicherte Änderungen wiederhergestellt.</span>
          <Button type="button" variant="ghost" size="xs" onClick={editor.discard}>
            Verwerfen
          </Button>
        </div>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabId)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="overflow-x-auto border-b px-4 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]">
          <TabsList variant="line" className="h-9 w-max" aria-label="Bereiche des Tasks">
            {(Object.keys(TAB_LABELS) as TabId[]).map((id) => (
              <TabsTrigger key={id} value={id} className="flex-none px-2.5 text-[13px]">
                {TAB_LABELS[id]}
                {id === "steps" && stepCount > 0 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {stepCount}
                  </span>
                )}
                {id === "schedule" && task.schedules.length > 0 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {task.schedules.length}
                  </span>
                )}
                {errorTabs.has(id) && (
                  <span
                    className="size-1.5 rounded-full bg-destructive"
                    role="img"
                    aria-label="enthält Fehler"
                  />
                )}
                {id === "schedule" && schedulesFeature.isNew && <NewBadge />}
                {id === "notifications" && notificationsFeature.isNew && <NewBadge />}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <StepFormContext.Provider value={taskContext}>
          <TabsContent
            value="steps"
            className="mt-0 flex min-h-0 flex-1 flex-col focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <div className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
              <StepViewSwitch forced={narrow} />
              {graphMode && (
                <>
                  <span
                    aria-hidden
                    className="hidden items-center gap-3 text-[11px] text-muted-foreground @4xl/editor:flex"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="h-px w-4 bg-muted-foreground/60" />
                      Ablauf
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-4 border-t border-dashed border-destructive" />
                      Bei Fehler
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-px w-4 bg-sky-600" />
                      Gehe zu
                    </span>
                  </span>
                  <StepAddMenu onPick={(type) => addStep(type, null)} align="end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="automation-add-step"
                      className="ml-auto h-7 text-xs"
                    >
                      <PlusIcon />
                      Schritt hinzufügen
                    </Button>
                  </StepAddMenu>
                </>
              )}
            </div>
            {graphMode ? (
              <div className="flex min-h-0 flex-1">
                <StepGraphView
                  task={task}
                  selectedId={selected?.step.id ?? null}
                  issues={issues}
                  runSteps={activeRun?.steps ?? null}
                  onSelect={setSelectedId}
                  onChange={setSteps}
                  onInsert={insertAt}
                  onRemove={removeSelected}
                  onDuplicate={duplicate}
                  connectionName={connectionName}
                  taskName={taskName}
                  taskNames={taskNames}
                />
                {(selected || steps.length === 0) && (
                  <aside
                    aria-label={selected ? "Schritt bearbeiten" : "Schrittkatalog"}
                    className="flex w-[min(30rem,50%)] shrink-0 flex-col border-l bg-background animate-in duration-200 ease-out fade-in-0 slide-in-from-right-2 motion-reduce:slide-in-from-right-0"
                  >
                    {selected ? (
                      stepEditor(selected, () => setSelectedId(null))
                    ) : (
                      <div className="min-h-0 flex-1 overflow-y-auto">
                        <StepCatalogGrid onPick={(type) => addStep(type, null)} />
                      </div>
                    )}
                  </aside>
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col @xl/editor:flex-row">
                <aside className="flex max-h-[38%] w-full shrink-0 flex-col border-b @xl/editor:max-h-none @xl/editor:w-56 @xl/editor:border-r @xl/editor:border-b-0 @3xl/editor:w-64 @4xl/editor:w-80">
                  <StepList
                    steps={steps}
                    selectedId={selected?.step.id ?? null}
                    issues={issues}
                    onSelect={setSelectedId}
                    onChange={setSteps}
                    onAdd={addStep}
                    onRemove={removeSelected}
                    onDuplicate={duplicate}
                    connectionName={connectionName}
                    taskName={taskName}
                  />
                </aside>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {selected ? (
                    stepEditor(selected)
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <StepCatalogGrid onPick={(type) => addStep(type, null)} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent
            value="schedule"
            className="@container/tab mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <div ref={schedulesFeature.ref}>
              <ScheduleTab
                task={task}
                tasks={tasks}
                issues={issues}
                onChange={(schedules) => patch({ schedules })}
              />
            </div>
          </TabsContent>
          <TabsContent
            value="variables"
            className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <VariablesTab task={task} issues={issues} onChange={patch} />
          </TabsContent>
          <TabsContent
            value="notifications"
            className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <div ref={notificationsFeature.ref}>
              <NotificationsTab
                task={task}
                onChange={(notifications) => patch({ notifications })}
              />
            </div>
          </TabsContent>
          <TabsContent
            value="settings"
            className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <TaskGeneralTab task={task} tasks={tasks} issues={issues} onChange={patch} />
          </TabsContent>
        </StepFormContext.Provider>
      </Tabs>
      {activeRun && <TaskRunBar run={activeRun} />}
      {!activeRun && task.needsReview && (
        <div className="flex items-center gap-2 border-t bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
          <ListTreeIcon className="size-3.5 shrink-0" aria-hidden />
          Importiert: Prüfe Verbindungen, Pfade und Empfänger, dann speichern. Bis dahin laufen
          keine Zeitpläne.
        </div>
      )}
    </div>
  );
}
