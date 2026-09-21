import { Link } from "@tanstack/react-router";
import { ActivityIcon, AlertTriangleIcon, GaugeIcon, LockKeyhole } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { TabsContent } from "@/components/ui/tabs";
import { formatElapsed, sessionStateVariant } from "@/features/monitor/monitor-view/format";
import type { MonitorViewState } from "@/features/monitor/monitor-view/use-monitor-view";

export function ActivityTab({ m }: { m: MonitorViewState }) {
  const {
    capabilities,
    sessionsQuery,
    locksQuery,
    visibleSessions,
    activeSessions,
    blockedSessions,
  } = m;
  return (
    <TabsContent value="activity" className="mt-5 space-y-5">
      <div
        className={`grid grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-2xl border bg-card ${capabilities.locks ? "md:grid-cols-4" : "md:grid-cols-3"}`}
      >
        {[
          {
            label: "Sessions",
            value: capabilities.sessions
              ? sessionsQuery.isPending
                ? "…"
                : (sessionsQuery.data?.length ?? 0).toLocaleString("de-DE")
              : "—",
            detail: capabilities.sessions ? "Alle Verbindungen" : "Nicht verfügbar",
            icon: ActivityIcon,
          },
          {
            label: "Aktiv",
            value:
              capabilities.sessions && activeSessions != null
                ? activeSessions.toLocaleString("de-DE")
                : "—",
            detail: "Laufende Queries",
            icon: GaugeIcon,
          },
          {
            label: "Blockiert",
            value:
              capabilities.sessions && blockedSessions != null
                ? blockedSessions.toLocaleString("de-DE")
                : "—",
            detail: "Warten auf andere Sessions",
            icon: AlertTriangleIcon,
          },
          {
            supported: capabilities.locks,
            label: "Locks",
            value: capabilities.locks
              ? locksQuery.isPending
                ? "…"
                : (locksQuery.data?.length ?? 0).toLocaleString("de-DE")
              : "—",
            detail: capabilities.locks ? "Aktuelle Locks" : "Nicht verfügbar",
            icon: LockKeyhole,
          },
        ]
          .filter((stat) => stat.supported !== false)
          .map(({ label, value, detail, icon: Icon }) => (
            <div key={label} className="min-w-0 px-5 py-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="size-3.5 text-primary" />
                {label}
              </div>
              <p className="mt-2 text-2xl font-medium tracking-tight">{value}</p>
              <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
            </div>
          ))}
      </div>

      <div
        className={`grid items-start gap-5 ${capabilities.locks ? "xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]" : ""}`}
      >
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ActivityIcon className="size-4 text-primary" />
              Aktive Sessions
            </CardTitle>
            <CardDescription>
              Laufende und wartende Sessions, automatisch alle 5 Sekunden aktualisiert.
            </CardDescription>
            <CardAction>
              <Link to="/sessions" className="text-xs text-primary hover:underline">
                Vollständige Ansicht
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            {!capabilities.sessions ? (
              <p className="px-6 py-8 text-center text-xs text-muted-foreground">
                Dieser Provider unterstützt keine Session-Übersicht.
              </p>
            ) : sessionsQuery.isPending ? (
              <div className="flex items-center justify-center gap-2 px-6 py-8 text-xs text-muted-foreground">
                <Spinner />
                Sessions werden geladen…
              </div>
            ) : sessionsQuery.isError ? (
              <p className="px-6 py-8 text-center text-xs text-destructive">
                {String(sessionsQuery.error)}
              </p>
            ) : visibleSessions.length === 0 ? (
              <p className="px-6 py-8 text-center text-xs text-muted-foreground">
                Keine Sessions gefunden.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/30 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Benutzer / App</th>
                      <th className="px-4 py-2 font-medium">Query</th>
                      <th className="px-4 py-2 font-medium">Wartet auf</th>
                      <th className="px-4 py-2 text-right font-medium">Alter</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {visibleSessions.map((session) => (
                      <tr key={session.pid} className="hover:bg-muted/30">
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <Badge
                            variant={sessionStateVariant(session)}
                            className="px-1.5 py-0 text-[10px]"
                          >
                            {session.blocked_by.length > 0
                              ? "blockiert"
                              : session.state || "unbekannt"}
                          </Badge>
                        </td>
                        <td className="max-w-44 px-4 py-2.5">
                          <span className="block truncate">{session.user || "—"}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {session.application || session.database || "—"}
                          </span>
                        </td>
                        <td
                          className="max-w-[480px] truncate px-4 py-2.5 font-mono text-muted-foreground"
                          title={session.query}
                        >
                          {session.query || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {session.wait_event ||
                            (session.blocked_by.length > 0 ? session.blocked_by.join(", ") : "—")}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {formatElapsed(session.query_start)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {capabilities.locks && (
          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-sm">
                <LockKeyhole className="size-4 text-primary" />
                Locks
              </CardTitle>
              <CardDescription>Aktuelle Sperren und wartende Lock-Anfragen.</CardDescription>
              <CardAction>
                <Link to="/sessions" className="text-xs text-primary hover:underline">
                  Details
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              {locksQuery.isPending ? (
                <div className="flex items-center justify-center gap-2 px-6 py-8 text-xs text-muted-foreground">
                  <Spinner />
                  Locks werden geladen…
                </div>
              ) : locksQuery.isError ? (
                <p className="px-6 py-8 text-center text-xs text-destructive">
                  {String(locksQuery.error)}
                </p>
              ) : locksQuery.data?.length ? (
                <div className="divide-y divide-border/60">
                  {locksQuery.data.slice(0, 14).map((lock) => (
                    <div
                      key={[
                        lock.pid,
                        lock.lock_type,
                        lock.relation ?? "",
                        lock.mode,
                        lock.granted,
                      ].join("|")}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs"
                    >
                      <span className="w-12 shrink-0 font-mono tabular-nums">{lock.pid}</span>
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {lock.relation || lock.lock_type}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {lock.mode}
                      </span>
                      <Badge
                        variant={lock.granted ? "secondary" : "destructive"}
                        className="shrink-0 px-1.5 py-0 text-[10px]"
                      >
                        {lock.granted ? "gewährt" : "wartet"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-6 py-8 text-center text-xs text-muted-foreground">
                  Keine Locks vorhanden.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </TabsContent>
  );
}
