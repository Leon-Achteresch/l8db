import { MoreVerticalIcon, SquareIcon, UserIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatSeconds } from "@/features/monitor/monitor-view/format";
import { LocksTable } from "@/features/sessions/sessions-view/locks-table";
import { copyWithToast } from "@/lib/clipboard";
import type { SessionInfo } from "@/lib/db";
import { cn } from "@/lib/utils";
import { LiveQueryCard } from "./live-query-card";
import { clientAddress, sessionDotClass, sessionStateLabel } from "./session-state";
import { type LiveMonitorState, sessionRuntime } from "./use-live-monitor";

export function LiveSessionDetails({ m, session }: { m: LiveMonitorState; session: SessionInfo }) {
  const locks = m.locks.filter((lock) => lock.pid === session.pid);
  const blockers = session.blocked_by
    .map((pid) => m.sessions.find((candidate) => candidate.pid === pid) ?? null)
    .map((candidate, index) => ({ pid: session.blocked_by[index], candidate }));
  const acting = m.actingPid === session.pid;
  const rows: [string, string][] = [
    ["Benutzer", session.user || "—"],
    ["Client-Adresse", clientAddress(session)],
    [
      "Startzeit",
      formatDateTime(session.query_start?.startsWith("vor") ? null : session.query_start),
    ],
    ["Laufzeit", formatSeconds(sessionRuntime(session, m.now))],
    ["Status", sessionStateLabel(session)],
    [
      "Wartet auf",
      session.wait_event
        ? [session.wait_event_type, session.wait_event].filter(Boolean).join(": ")
        : "—",
    ],
    ["Transaktion", session.backend_xid ? `ID ${session.backend_xid}` : "—"],
    ["Isolationslevel", m.metrics?.default_isolation ?? "—"],
    ["Anwendung", session.application || "—"],
    ["Prozesstyp", session.backend_type ?? "—"],
    ["Backend-Start", formatDateTime(session.backend_start ?? null)],
    ["Letzte Aktivität", formatDateTime(session.state_change ?? null)],
  ];

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm">Session-Details</CardTitle>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Details schließen"
          onClick={m.closeDetails}
        >
          <XIcon />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-full border bg-muted/40">
            <UserIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-semibold">PID {session.pid}</span>
              <Badge variant="outline" className="gap-1.5 px-2 py-0 text-[10px]">
                <span className={cn("size-1.5 rounded-full", sessionDotClass(session))} />
                {sessionStateLabel(session)}
              </Badge>
            </div>
            {session.is_self && (
              <p className="text-[11px] text-muted-foreground">Eigene Monitor-Verbindung</p>
            )}
          </div>
          <Button
            size="sm"
            disabled={acting || session.is_self || session.state !== "active"}
            onClick={() => void m.stopQuery(session.pid)}
          >
            <SquareIcon />
            Stoppen
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Weitere Session-Aktionen">
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyWithToast(String(session.pid), "PID")}>
                PID kopieren
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!session.query.trim()}
                onSelect={() => m.openInEditor(session.query, session.pid)}
              >
                Im Query-Editor öffnen
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={acting || session.is_self}
                onSelect={() => void m.terminate(session.pid)}
              >
                Session beenden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Tabs defaultValue="details">
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="details" className="text-xs">
              Details
            </TabsTrigger>
            <TabsTrigger value="query" className="text-xs">
              Aktuelle Abfrage
            </TabsTrigger>
            <TabsTrigger value="locks" className="text-xs">
              Locks ({locks.length})
            </TabsTrigger>
            <TabsTrigger value="waiting" className="text-xs">
              Wartet auf ({blockers.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="mt-3">
            <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-xs">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate font-mono" title={value}>
                    {label === "Status" ? (
                      <span className="flex items-center gap-1.5 font-sans">
                        <span className={cn("size-2 rounded-full", sessionDotClass(session))} />
                        {value}
                      </span>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </TabsContent>
          <TabsContent value="query" className="mt-3">
            <LiveQueryCard m={m} session={session} bare />
          </TabsContent>
          <TabsContent value="locks" className="mt-3 max-h-72 overflow-auto rounded-lg border">
            <LocksTable locks={locks} />
          </TabsContent>
          <TabsContent value="waiting" className="mt-3">
            {blockers.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                Diese Session wartet auf keine andere Session.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border text-xs">
                {blockers.map(({ pid, candidate }) => (
                  <li key={pid} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-mono font-medium">PID {pid}</span>
                      <span className="ml-2 truncate text-muted-foreground">
                        {candidate
                          ? `${candidate.user} · ${candidate.state ?? "—"}`
                          : "nicht mehr vorhanden"}
                      </span>
                    </span>
                    {candidate && (
                      <Button variant="outline" size="xs" onClick={() => m.selectSession(pid)}>
                        Anzeigen
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
