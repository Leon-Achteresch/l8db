import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LockIcon,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import { cancelSession, terminateSession } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { useLocksQuery, useSessionsQuery } from "@/lib/queries";
import {
  type BlockingInfo,
  computeBlocking,
  EMPTY_SESSION_FILTERS,
  filterSessions,
  groupSessions,
  type SessionFilters,
  sessionStates,
} from "@/lib/session-filters";
import { useSessionViewPrefs } from "@/lib/session-view-prefs";
import { effectiveConnectionString } from "@/lib/ssh";

import { SchedulerJobsPanel } from "./scheduler-jobs-panel";
import { SessionRow } from "./session-row";
import { SessionsFilterBar } from "./sessions-filter-bar";

export function SessionsView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("sessions");
  const [actingPid, setActingPid] = useState<number | null>(null);
  const [filters, setFilters] = useState<SessionFilters>(EMPTY_SESSION_FILTERS);
  const [highlightedPid, setHighlightedPid] = useState<number | null>(null);
  const { data: sessions, isLoading, isError, error } = useSessionsQuery();
  const { data: locks } = useLocksQuery();
  const capabilities = useActiveCapabilities();
  const showBlocking = Boolean(capabilities?.sessions && capabilities?.locks);
  const grouping = useSessionViewPrefs((s) => s.grouping);
  const collapsedGroups = useSessionViewPrefs((s) => s.collapsedGroups);
  const setGrouping = useSessionViewPrefs((s) => s.setGrouping);
  const toggleGroup = useSessionViewPrefs((s) => s.toggleGroup);
  const setCollapsedGroups = useSessionViewPrefs((s) => s.setCollapsedGroups);

  const allSessions = useMemo(() => sessions ?? [], [sessions]);
  const blocking = useMemo(
    () => (showBlocking ? computeBlocking(allSessions) : new Map<number, BlockingInfo>()),
    [allSessions, showBlocking],
  );
  const blockedCount = useMemo(
    () => [...blocking.values()].filter((info) => info.blockedBy.length > 0).length,
    [blocking],
  );
  const states = useMemo(() => sessionStates(allSessions), [allSessions]);
  const filtered = useMemo(() => filterSessions(allSessions, filters), [allSessions, filters]);
  const groups = useMemo(() => groupSessions(filtered, grouping), [filtered, grouping]);

  useEffect(() => {
    if (highlightedPid === null) return;
    const timer = window.setTimeout(() => setHighlightedPid(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightedPid]);

  const jumpToSession = (pid: number) => {
    const target = filtered.find((s) => s.pid === pid);
    if (!target) {
      toast.info(
        allSessions.some((s) => s.pid === pid)
          ? `Sitzung ${pid} ist durch die Filter ausgeblendet.`
          : `Sitzung ${pid} ist nicht mehr vorhanden.`,
      );
      return;
    }
    if (grouping !== "none") {
      const key = grouping === "user" ? target.user : target.application || "";
      if (collapsedGroups.includes(key)) toggleGroup(key);
    }
    setHighlightedPid(pid);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`session-row-${pid}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

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
      toast.success(
        cancelled ? `Abfrage auf PID ${pid} abgebrochen.` : `PID ${pid}: nichts abzubrechen.`,
      );
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setActingPid(null);
    }
  };

  const handleTerminate = async (pid: number) => {
    if (!connection) return;
    if (
      !window.confirm(
        `Sitzung mit PID ${pid} wirklich beenden? Offene Transaktionen gehen verloren.`,
      )
    )
      return;
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
        {blockedCount > 0 && (
          <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">
            {blockedCount} blockiert
          </Badge>
        )}
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="sessions" className="gap-1.5 text-xs">
            <ActivityIcon className="size-3.5" />
            Sitzungen (
            {filtered.length === allSessions.length
              ? allSessions.length
              : `${filtered.length}/${allSessions.length}`}
            )
          </TabsTrigger>
          <TabsTrigger value="locks" className="gap-1.5 text-xs">
            <LockIcon className="size-3.5" />
            Locks ({locks?.length ?? 0})
          </TabsTrigger>
          {capabilities?.scheduler_jobs && (
            <TabsTrigger value="jobs" className="gap-1.5 text-xs">
              <CalendarClockIcon className="size-3.5" />
              Jobs
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="jobs" className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <SchedulerJobsPanel />
          </div>
        </TabsContent>

        <TabsContent value="sessions" className="flex min-h-0 flex-1 flex-col gap-2">
          <SessionsFilterBar
            filters={filters}
            onFiltersChange={setFilters}
            states={states}
            grouping={grouping}
            onGroupingChange={setGrouping}
            shown={filtered.length}
            total={allSessions.length}
            groupCount={groups.length}
            onExpandAll={() => setCollapsedGroups([])}
            onCollapseAll={() => setCollapsedGroups(groups.map((g) => g.key))}
          />
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
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
                    <th className="px-3 py-2 font-medium">Blockierung</th>
                    <th className="px-3 py-2 font-medium">Wartet auf</th>
                    <th className="px-3 py-2 font-medium">Query</th>
                    <th className="px-3 py-2 font-medium">Start</th>
                    <th className="px-3 py-2 text-right font-medium">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {groups.map((group) => {
                    const collapsed = grouping !== "none" && collapsedGroups.includes(group.key);
                    return (
                      <Fragment key={grouping === "none" ? "__all__" : `g-${group.key}`}>
                        {grouping !== "none" && (
                          <tr
                            className="cursor-pointer bg-muted/30 hover:bg-muted/50"
                            onClick={() => toggleGroup(group.key)}
                          >
                            <td colSpan={9} className="px-3 py-1.5 font-medium">
                              <span className="inline-flex items-center gap-1.5">
                                {collapsed ? (
                                  <ChevronRightIcon className="size-3.5" />
                                ) : (
                                  <ChevronDownIcon className="size-3.5" />
                                )}
                                {group.label}
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  {group.sessions.length}
                                </Badge>
                              </span>
                            </td>
                          </tr>
                        )}
                        {!collapsed &&
                          group.sessions.map((session) => (
                            <SessionRow
                              key={session.pid}
                              session={session}
                              blocking={blocking.get(session.pid)}
                              highlighted={highlightedPid === session.pid}
                              acting={actingPid === session.pid}
                              onJump={jumpToSession}
                              onCancel={(pid) => void handleCancel(pid)}
                              onTerminate={(pid) => void handleTerminate(pid)}
                            />
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {allSessions.length === 0
                  ? "Keine Sitzungen."
                  : "Keine Sitzungen entsprechen den Filtern."}
              </p>
            )}
          </div>
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
                <tr
                  key={`${lock.pid}-${lock.lock_type}-${lock.relation ?? ""}-${lock.mode}-${index}`}
                  className="hover:bg-muted/40"
                >
                  <td className="px-3 py-2 font-mono tabular-nums">{lock.pid}</td>
                  <td className="px-3 py-2 font-mono">{lock.lock_type}</td>
                  <td className="px-3 py-2 font-mono">{lock.relation ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">{lock.mode}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={lock.granted ? "secondary" : "destructive"}
                      className="px-1.5 py-0 text-[10px]"
                    >
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
