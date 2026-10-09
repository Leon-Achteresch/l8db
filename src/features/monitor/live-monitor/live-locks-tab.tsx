import { LockIcon, LockOpenIcon, OctagonAlertIcon } from "lucide-react";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { formatCount } from "@/features/monitor/monitor-view/format";
import { LocksTable } from "@/features/sessions/sessions-view/locks-table";
import { LiveStatTile } from "./live-stat-tile";
import type { LiveMonitorState } from "./use-live-monitor";

const LOCK_RENDER_LIMIT = 500;

export function LiveLocksTab({
  m,
  onOpenSession,
}: {
  m: LiveMonitorState;
  onOpenSession: (pid: number) => void;
}) {
  const sorted = useMemo(
    () => [...m.locks].sort((a, b) => Number(a.granted) - Number(b.granted)),
    [m.locks],
  );
  const blocked = m.sessions.filter((session) => session.blocked_by.length > 0);
  return (
    <TabsContent value="locks" className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <LiveStatTile label="Locks gesamt" icon={LockIcon} value={formatCount(m.locks.length)} />
        <LiveStatTile
          label="Wartende Locks"
          icon={LockOpenIcon}
          value={formatCount(m.waitingLocks)}
          tone={m.waitingLocks > 0 ? "warning" : "default"}
          progress={m.locks.length ? (m.waitingLocks / m.locks.length) * 100 : 0}
        />
        <LiveStatTile
          label="Blockierte Sessions"
          icon={OctagonAlertIcon}
          value={formatCount(blocked.length)}
          tone={blocked.length > 0 ? "danger" : "default"}
        />
      </div>
      {blocked.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Blockierungen</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border text-xs">
              {blocked.map((session) => (
                <li key={session.pid}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => onOpenSession(session.pid)}
                  >
                    <span className="font-mono">
                      PID {session.pid} ({session.user}) wartet auf{" "}
                      {session.blocked_by.map((pid) => `PID ${pid}`).join(", ")}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {session.wait_event ?? ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card size="sm" className="gap-0 py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">Alle Locks</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[560px] overflow-auto p-0">
          {!m.capabilities.locks ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              Diese Datenbank stellt keine Lock-Liste bereit.
            </p>
          ) : (
            <>
              <LocksTable locks={sorted.slice(0, LOCK_RENDER_LIMIT)} />
              {sorted.length > LOCK_RENDER_LIMIT && (
                <p className="border-t px-3 py-2 text-center text-[11px] text-muted-foreground">
                  {sorted.length - LOCK_RENDER_LIMIT} weitere Locks ausgeblendet.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
