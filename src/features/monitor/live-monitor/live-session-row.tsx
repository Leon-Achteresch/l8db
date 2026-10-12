import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatSeconds } from "@/features/monitor/monitor-view/format";
import type { SessionInfo } from "@/lib/db";
import { cn } from "@/lib/utils";
import { clientAddress, sessionDotClass, sessionStateLabel, shortQuery } from "./session-state";
import { sessionRuntime } from "./use-live-monitor";

export function LiveSessionRow({
  session,
  index,
  now,
  selected,
  acting,
  onSelect,
  onStop,
  onTerminate,
  onCopy,
  onOpen,
}: {
  session: SessionInfo;
  index: number;
  now: number;
  selected: boolean;
  acting: boolean;
  onSelect: (pid: number) => void;
  onStop: (pid: number) => void;
  onTerminate: (pid: number) => void;
  onCopy: (sql: string) => void;
  onOpen: (sql: string, pid: number) => void;
}) {
  const hasQuery = Boolean(session.query.trim());
  const idle = session.state === "idle";
  return (
    <tr
      aria-selected={selected}
      onClick={() => onSelect(session.pid)}
      className={cn(
        "cursor-pointer border-b border-border/60 hover:bg-muted/40",
        selected && "bg-primary/8 hover:bg-primary/10",
      )}
    >
      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{index + 1}</td>
      <td className="px-3 py-1.5 font-mono tabular-nums">
        {session.pid}
        {session.is_self && <span className="ml-1 text-[10px] text-muted-foreground">(ich)</span>}
      </td>
      <td className="max-w-32 truncate px-3 py-1.5">{session.user || "—"}</td>
      <td className="max-w-32 truncate px-3 py-1.5">{session.database || "—"}</td>
      <td className="px-3 py-1.5 font-mono whitespace-nowrap">{clientAddress(session)}</td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", sessionDotClass(session))} />
          {sessionStateLabel(session)}
        </span>
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
        {formatSeconds(sessionRuntime(session, now))}
      </td>
      <td
        className="max-w-56 truncate px-3 py-1.5 font-mono text-primary"
        title={hasQuery ? session.query : undefined}
      >
        {hasQuery && !idle ? shortQuery(session.query, 40) : "—"}
      </td>
      <td className="px-3 py-1 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            disabled={acting || session.is_self || session.state !== "active"}
            onClick={(event) => {
              event.stopPropagation();
              onStop(session.pid);
            }}
          >
            Stoppen
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Aktionen für PID ${session.pid}`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={() => onSelect(session.pid)}>
                Details anzeigen
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!hasQuery} onSelect={() => onCopy(session.query)}>
                Abfrage kopieren
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasQuery}
                onSelect={() => onOpen(session.query, session.pid)}
              >
                Im Query-Editor öffnen
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={acting || session.is_self || session.state !== "active"}
                onSelect={() => onStop(session.pid)}
              >
                Abfrage stoppen
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={acting || session.is_self}
                onSelect={() => onTerminate(session.pid)}
              >
                Session beenden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}
