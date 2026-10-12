import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClipboardIcon,
  FolderOpenIcon,
  HistoryIcon,
  TerminalIcon,
} from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/backup";
import { copyWithToast } from "@/lib/clipboard";
import { isTaskActive, useTasksStore } from "@/lib/tasks";

interface BackupHistoryProps {
  connectionId: string;
  database: string | null;
  canRestore: boolean;
  onRestore: (path: string) => void;
}

interface BackupResult {
  path?: string;
  command?: string;
  bytes?: number | null;
}

const PREFIX = "Sicherung · ";

function when(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Heute ${time}`;
  return `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Min.`;
}

export function BackupHistory({
  connectionId,
  database,
  canRestore,
  onRestore,
}: BackupHistoryProps) {
  const tasks = useTasksStore((state) => state.tasks);
  const entries = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.connectionId === connectionId &&
          (task.database ?? null) === database &&
          task.title.startsWith(PREFIX),
      ),
    [tasks, connectionId, database],
  );
  const total = entries.reduce(
    (sum, task) => sum + ((task.result as BackupResult | undefined)?.bytes ?? 0),
    0,
  );

  return (
    <aside className="hidden min-h-0 w-[21rem] shrink-0 flex-col border-l lg:flex">
      <div className="flex h-10 shrink-0 items-center px-4">
        <h3 className="text-xs font-semibold">Letzte Sicherungen</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-4 py-2 text-xs text-muted-foreground">Noch keine Sicherungen.</p>
        ) : (
          <ul>
            {entries.map((task) => {
              const result = task.result as BackupResult | undefined;
              const path = result?.path;
              const name = path?.split(/[\\/]/).pop() || task.title.slice(PREFIX.length);
              const active = isTaskActive(task);
              const icon = active ? (
                <Spinner className="size-3.5 text-muted-foreground" />
              ) : task.status === "success" ? (
                <CircleCheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : task.status === "interrupted" ? (
                <CircleAlertIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
              ) : (
                <CircleXIcon className="size-3.5 text-destructive" />
              );
              const status = active
                ? "Läuft"
                : task.status === "cancelled"
                  ? "Abgebrochen"
                  : task.status === "error"
                    ? "Fehlgeschlagen"
                    : task.status === "interrupted"
                      ? "Unterbrochen"
                      : null;
              return (
                <li key={task.id}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 border-b px-4 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 data-[state=open]:bg-muted/60"
                      title={task.error ?? path}
                    >
                      <span className="mt-0.5">{icon}</span>
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate font-mono text-xs">{name}</span>
                        <span className="truncate text-[11px] text-muted-foreground tabular-nums">
                          {when(task.startedAt)}
                          {task.finishedAt
                            ? ` · ${duration(task.finishedAt - task.startedAt)}`
                            : ""}
                          {status && (
                            <span
                              className={
                                task.status === "error" || task.status === "cancelled"
                                  ? "text-destructive"
                                  : undefined
                              }
                            >
                              {" "}
                              · {status}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="mt-px text-xs text-muted-foreground tabular-nums">
                        {result?.bytes != null ? formatBytes(result.bytes) : "–"}
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {canRestore && (
                        <DropdownMenuItem
                          disabled={task.status !== "success" || !path}
                          onSelect={() => path && onRestore(path)}
                        >
                          <HistoryIcon />
                          Wiederherstellen…
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        disabled={!path}
                        onSelect={() =>
                          path &&
                          void revealItemInDir(path).catch((failure) =>
                            toast.error(String(failure)),
                          )
                        }
                      >
                        <FolderOpenIcon />
                        Im Ordner zeigen
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!path}
                        onSelect={() => path && void copyWithToast(path, "Pfad")}
                      >
                        <ClipboardIcon />
                        Pfad kopieren
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!result?.command}
                        onSelect={() =>
                          result?.command && void copyWithToast(result.command, "Befehl")
                        }
                      >
                        <TerminalIcon />
                        Befehl kopieren
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t px-4 text-xs">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => useTasksStore.setState({ open: true })}
        >
          Alle Aufgaben
        </button>
        <span className="text-muted-foreground tabular-nums">
          {entries.length} Sicherungen{total > 0 ? `, ${formatBytes(total)}` : ""}
        </span>
      </div>
    </aside>
  );
}
