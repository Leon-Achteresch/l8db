import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, LockIcon, OctagonXIcon, StopCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import { effectiveConnectionString } from "@/lib/ssh";
import { cancelSession, terminateSession } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useLocksQuery, useSessionsQuery } from "@/lib/queries";

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

export function SessionsView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("sessions");
  const [actingPid, setActingPid] = useState<number | null>(null);
  const { data: sessions, isLoading, isError, error } = useSessionsQuery();
  const { data: locks } = useLocksQuery();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["locks"] });
  };

  const handleCancel = async (pid: number) => {
    if (!connection) return;
    setActingPid(pid);
    try {
      const cancelled = await cancelSession(
        connection.kind,
        effectiveConnectionString(connection),
        pid,
        database ?? undefined,
      );
      toast.success(cancelled ? `Abfrage auf PID ${pid} abgebrochen.` : `PID ${pid}: nichts abzubrechen.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setActingPid(null);
    }
  };

  const handleTerminate = async (pid: number) => {
    if (!connection) return;
    if (!window.confirm(`Sitzung mit PID ${pid} wirklich beenden? Offene Transaktionen gehen verloren.`)) return;
    setActingPid(pid);
    try {
      await terminateSession(
        connection.kind,
        effectiveConnectionString(connection),
        pid,
        database ?? undefined,
      );
      toast.success(`Sitzung ${pid} beendet.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setActingPid(null);
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-6xl min-h-0 flex-col gap-4 p-6">
      <header className="flex shrink-0 items-center gap-2">
        <ActivityIcon className="size-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">Sitzungen & Locks</h1>
        <span className="text-xs text-muted-foreground">aktualisiert alle 5 s</span>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="sessions" className="gap-1.5 text-xs">
            <ActivityIcon className="size-3.5" />
            Sitzungen ({sessions?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="locks" className="gap-1.5 text-xs">
            <LockIcon className="size-3.5" />
            Locks ({locks?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="min-h-0 flex-1 overflow-auto rounded-lg border">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Spinner />
              Lade Sitzungen…
            </div>
          ) : isError ? (
            <p className="p-8 text-center text-sm text-destructive">{String(error)}</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">PID</th>
                  <th className="px-3 py-2 font-medium">Benutzer</th>
                  <th className="px-3 py-2 font-medium">App</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Wartet auf</th>
                  <th className="px-3 py-2 font-medium">Query</th>
                  <th className="px-3 py-2 font-medium">Start</th>
                  <th className="px-3 py-2 text-right font-medium">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {(sessions ?? []).map((session) => (
                  <tr key={session.pid} className="hover:bg-muted/40">
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
                    <td className="px-3 py-2 font-mono text-muted-foreground">
                      {session.wait_event ?? "—"}
                    </td>
                    <td className="max-w-md truncate px-3 py-2 font-mono text-muted-foreground" title={session.query}>
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
                        disabled={actingPid === session.pid}
                        onClick={() => void handleCancel(session.pid)}
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
                          disabled={actingPid === session.pid}
                          onClick={() => void handleTerminate(session.pid)}
                          title="Sitzung hart beenden (Transaktionen gehen verloren)"
                        >
                          <OctagonXIcon className="size-3.5" />
                          Beenden
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabsContent>

        <TabsContent value="locks" className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">PID</th>
                <th className="px-3 py-2 font-medium">Typ</th>
                <th className="px-3 py-2 font-medium">Relation</th>
                <th className="px-3 py-2 font-medium">Modus</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {(locks ?? []).map((lock, index) => (
                <tr key={`${lock.pid}-${lock.lock_type}-${lock.relation ?? ""}-${lock.mode}-${index}`} className="hover:bg-muted/40">
                  <td className="px-3 py-2 font-mono tabular-nums">{lock.pid}</td>
                  <td className="px-3 py-2 font-mono">{lock.lock_type}</td>
                  <td className="px-3 py-2 font-mono">{lock.relation ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">{lock.mode}</td>
                  <td className="px-3 py-2">
                    <Badge variant={lock.granted ? "secondary" : "destructive"} className="px-1.5 py-0 text-[10px]">
                      {lock.granted ? "gewährt" : "wartet"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(locks?.length ?? 0) === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">Keine Locks.</p>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
