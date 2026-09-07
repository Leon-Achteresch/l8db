import { OctagonXIcon, StopCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SessionInfo } from "@/lib/db";
import type { BlockingInfo } from "@/lib/session-filters";
import { cn } from "@/lib/utils";

interface SessionRowProps {
  session: SessionInfo;
  blocking: BlockingInfo | undefined;
  highlighted: boolean;
  acting: boolean;
  onJump: (pid: number) => void;
  onCancel: (pid: number) => void;
  onTerminate: (pid: number) => void;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SessionRow({
  session,
  blocking,
  highlighted,
  acting,
  onJump,
  onCancel,
  onTerminate,
}: SessionRowProps) {
  const isBlocked = (blocking?.blockedBy.length ?? 0) > 0;
  const isBlocking = (blocking?.blocking.length ?? 0) > 0;

  return (
    <tr
      id={`session-row-${session.pid}`}
      className={cn(
        "hover:bg-muted/40",
        isBlocked && "bg-destructive/10 hover:bg-destructive/15",
        !isBlocked && isBlocking && "bg-amber-500/10 hover:bg-amber-500/15",
        highlighted && "ring-2 ring-inset ring-primary",
      )}
    >
      <td className="px-3 py-2 font-mono tabular-nums">
        {session.pid}
        {session.is_self && (
          <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-[9px]">
            ich
          </Badge>
        )}
      </td>
      <td className="px-3 py-2">{session.user}</td>
      <td className="max-w-32 truncate px-3 py-2 text-muted-foreground">
        {session.application || "—"}
      </td>
      <td className="px-3 py-2">
        {session.state ? (
          <Badge
            variant={session.state === "active" ? "default" : "outline"}
            className="px-1.5 py-0 text-[10px]"
          >
            {session.state}
          </Badge>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2">
        {!isBlocked && !isBlocking ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {isBlocked && (
              <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                blockiert von
              </Badge>
            )}
            {blocking?.blockedBy.map((pid) => {
              const missing = blocking.missingBlockers.includes(pid);
              return (
                <Button
                  key={`b-${pid}`}
                  variant="outline"
                  size="sm"
                  className="h-5 px-1.5 font-mono text-[10px] tabular-nums"
                  disabled={missing}
                  onClick={() => onJump(pid)}
                  title={
                    missing
                      ? `Sitzung ${pid} ist nicht mehr in der Liste`
                      : `Zu Sitzung ${pid} springen`
                  }
                >
                  {pid}
                  {missing && " (weg)"}
                </Button>
              );
            })}
            {isBlocking && (
              <Badge className="border-amber-500/40 bg-amber-500/20 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300">
                blockiert
              </Badge>
            )}
            {blocking?.blocking.map((pid) => (
              <Button
                key={`v-${pid}`}
                variant="outline"
                size="sm"
                className="h-5 px-1.5 font-mono text-[10px] tabular-nums"
                onClick={() => onJump(pid)}
                title={`Zu Sitzung ${pid} springen`}
              >
                {pid}
              </Button>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-muted-foreground">{session.wait_event ?? "—"}</td>
      <td
        className="max-w-md truncate px-3 py-2 font-mono text-muted-foreground"
        title={session.query}
      >
        {session.query || "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
        {formatTimestamp(session.query_start)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={acting}
          onClick={() => onCancel(session.pid)}
          title="Laufende Abfrage abbrechen (Verbindung bleibt)"
        >
          <StopCircleIcon className="size-3.5" />
          Abbrechen
        </Button>
        {!session.is_self && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
            disabled={acting}
            onClick={() => onTerminate(session.pid)}
            title="Sitzung hart beenden (Transaktionen gehen verloren)"
          >
            <OctagonXIcon className="size-3.5" />
            Beenden
          </Button>
        )}
      </td>
    </tr>
  );
}
