import { save } from "@tauri-apps/plugin-dialog";
import { DownloadIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { RUN_STATUSES, runStatusLabel, TRIGGER_KINDS, triggerLabel } from "@/lib/automation/format";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import {
  deleteAutomationRuns,
  exportAutomationRuns,
  type RunFilter,
  type RunStatus,
  type TriggerKind,
} from "@/lib/db/automation";
import { TaskFilterChip } from "./task-filter-chip";

type Range = "all" | "today" | "7d" | "30d" | "custom";

const RANGES: { value: Range; label: string }[] = [
  { value: "all", label: "Gesamter Zeitraum" },
  { value: "today", label: "Heute" },
  { value: "7d", label: "Letzte 7 Tage" },
  { value: "30d", label: "Letzte 30 Tage" },
  { value: "custom", label: "Eigener Zeitraum" },
];

function rangeBounds(range: Range, from: string, to: string): Pick<RunFilter, "from" | "to"> {
  const day = 86_400_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  switch (range) {
    case "today":
      return { from: startOfToday.toISOString(), to: null };
    case "7d":
      return { from: new Date(startOfToday.getTime() - 6 * day).toISOString(), to: null };
    case "30d":
      return { from: new Date(startOfToday.getTime() - 29 * day).toISOString(), to: null };
    case "custom":
      return {
        from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : null,
      };
    default:
      return { from: null, to: null };
  }
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function HistoryFilters() {
  const tasks = useAutomationStore((state) => state.tasks);
  const runs = useAutomationStore((state) => state.runs);
  const loadRuns = useAutomationStore((state) => state.loadRuns);
  const initial = useAutomationStore.getState().runFilter;
  const [taskId, setTaskId] = useState<string | null>(initial.taskId ?? null);
  const [statuses, setStatuses] = useState<RunStatus[]>(initial.statuses ?? []);
  const [triggers, setTriggers] = useState<TriggerKind[]>(initial.triggers ?? []);
  const [range, setRange] = useState<Range>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState(initial.text ?? "");
  const [query, setQuery] = useState(text);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const filter = useMemo<RunFilter>(
    () => ({
      taskId,
      statuses: statuses.length ? statuses : undefined,
      triggers: triggers.length ? triggers : undefined,
      ...rangeBounds(range, from, to),
      text: query || null,
      limit: 200,
    }),
    [taskId, statuses, triggers, range, from, to, query],
  );

  useEffect(() => {
    void loadRuns(filter);
  }, [filter, loadRuns]);

  const taskName = taskId ? tasks.find((task) => task.task.id === taskId)?.task.name : null;
  const deletable = runs.filter((run) => run.status !== "running");

  const exportRuns = async (format: "json" | "csv") => {
    try {
      const path = await save({
        defaultPath: `l8db-laeufe.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      const count = await exportAutomationRuns({ ...filter, limit: 1000 }, format, path);
      toast.success(count === 1 ? "1 Lauf exportiert" : `${count} Läufe exportiert`, {
        description: path,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removeRuns = async () => {
    try {
      const count = await deleteAutomationRuns(deletable.map((run) => run.id));
      setConfirm(false);
      await loadRuns(filter);
      toast.success(count === 1 ? "1 Lauf gelöscht" : `${count} Läufe gelöscht`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <search
      aria-label="Verlauf filtern"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-2"
    >
      <InputGroup className="h-7 w-56">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Fehler, Log, Task …"
          aria-label="Verlauf durchsuchen"
          className="text-xs"
        />
      </InputGroup>
      <TaskFilterChip label="Task" value={taskName ?? null}>
        <DropdownMenuCheckboxItem checked={!taskId} onCheckedChange={() => setTaskId(null)}>
          Alle Tasks
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {tasks.map((task) => (
          <DropdownMenuCheckboxItem
            key={task.task.id}
            checked={taskId === task.task.id}
            onCheckedChange={() => setTaskId(task.task.id)}
          >
            <span className="truncate">{task.task.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </TaskFilterChip>
      <TaskFilterChip
        label="Status"
        value={
          statuses.length === 0
            ? null
            : statuses.length === 1
              ? runStatusLabel(statuses[0])
              : `${statuses.length} gewählt`
        }
      >
        {RUN_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={statuses.includes(status)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => setStatuses((current) => toggle(current, status))}
          >
            {runStatusLabel(status)}
          </DropdownMenuCheckboxItem>
        ))}
      </TaskFilterChip>
      <TaskFilterChip
        label="Auslöser"
        value={
          triggers.length === 0
            ? null
            : triggers.length === 1
              ? triggerLabel(triggers[0])
              : `${triggers.length} gewählt`
        }
      >
        {TRIGGER_KINDS.map((trigger) => (
          <DropdownMenuCheckboxItem
            key={trigger}
            checked={triggers.includes(trigger)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => setTriggers((current) => toggle(current, trigger))}
          >
            {triggerLabel(trigger)}
          </DropdownMenuCheckboxItem>
        ))}
      </TaskFilterChip>
      <TaskFilterChip
        label="Zeitraum"
        value={
          range === "all" ? null : (RANGES.find((entry) => entry.value === range)?.label ?? null)
        }
      >
        {RANGES.map((entry) => (
          <DropdownMenuCheckboxItem
            key={entry.value}
            checked={range === entry.value}
            onCheckedChange={() => setRange(entry.value)}
          >
            {entry.label}
          </DropdownMenuCheckboxItem>
        ))}
      </TaskFilterChip>
      {range === "custom" && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Von"
            className="h-7 w-[8.5rem] text-xs"
          />
          –
          <Input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="Bis"
            className="h-7 w-[8.5rem] text-xs"
          />
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="ghost" disabled={runs.length === 0}>
              <DownloadIcon />
              Exportieren
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void exportRuns("json")}>Als JSON</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportRuns("csv")}>Als CSV</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="xs"
          variant="ghost"
          disabled={deletable.length === 0}
          onClick={() => setConfirm(true)}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon />
          Löschen
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletable.length === 1 ? "1 Lauf löschen?" : `${deletable.length} Läufe löschen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Gelöscht werden alle Läufe, die der aktuelle Filter zeigt, mit Logs und Schritten.
              Ausgabedateien bleiben auf der Festplatte. Laufende Läufe werden übersprungen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void removeRuns();
              }}
            >
              {deletable.length === 1 ? "Lauf löschen" : "Läufe löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </search>
  );
}
