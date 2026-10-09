import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontalIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { copyWithToast } from "@/lib/clipboard";
import { LiveSessionRow } from "./live-session-row";
import { clientAddress } from "./session-state";
import {
  LIVE_SESSION_RENDER_LIMIT,
  type LiveMonitorState,
  sessionRuntime,
} from "./use-live-monitor";

const ALL = "__all__";

export function LiveSessionsCard({ m }: { m: LiveMonitorState }) {
  const navigate = useNavigate();
  const { filters, setFilters, filterOptions, filteredSessions, sessionsQuery } = m;
  const visible = filteredSessions.slice(0, LIVE_SESSION_RENDER_LIMIT);
  const filterSelect = (key: "state" | "user" | "database", label: string, options: string[]) => (
    <Select
      value={filters[key] || ALL}
      onValueChange={(value) => setFilters({ ...filters, [key]: value === ALL ? "" : value })}
    >
      <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const exportCsv = () => {
    const header = "pid;user;database;client;state;runtime_s;query";
    const lines = filteredSessions.map((session) =>
      [
        session.pid,
        session.user,
        session.database,
        clientAddress(session),
        session.state ?? "",
        Math.round(sessionRuntime(session, m.now) ?? 0),
        `"${session.query.replace(/"/g, '""')}"`,
      ].join(";"),
    );
    void copyWithToast([header, ...lines].join("\n"), "Session-Liste");
  };

  return (
    <Card size="sm" className="min-w-0 gap-0 py-0">
      <CardHeader className="flex flex-wrap items-center gap-2 border-b py-3">
        <CardTitle className="mr-2 text-sm">Aktive Sessions ({filteredSessions.length})</CardTitle>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Sessions filtern…"
            aria-label="Sessions filtern"
            className="h-8 w-44 pl-8 text-xs"
          />
        </div>
        {filterSelect("state", "Alle States", filterOptions.states)}
        {filterSelect("user", "Alle Benutzer", filterOptions.users)}
        {filterSelect("database", "Alle Datenbanken", filterOptions.databases)}
        <Button size="sm" className="h-8" onClick={m.refresh} disabled={sessionsQuery.isFetching}>
          <RefreshCwIcon className={sessionsQuery.isFetching ? "animate-spin" : undefined} />
          Aktualisieren
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Weitere Session-Aktionen">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={m.resetFilters}>Filter zurücksetzen</DropdownMenuItem>
            <DropdownMenuItem onSelect={exportCsv} disabled={filteredSessions.length === 0}>
              Liste als CSV kopieren
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void navigate({ to: "/sessions" })}>
              Sitzungsverwaltung öffnen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="p-0">
        {!m.capabilities.sessions ? (
          <p className="p-8 text-center text-xs text-muted-foreground">
            Diese Datenbank stellt keine Sitzungsliste bereit.
          </p>
        ) : sessionsQuery.isPending ? (
          <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
            <Spinner />
            Sessions werden geladen…
          </div>
        ) : sessionsQuery.isError ? (
          <p className="p-6 text-xs text-destructive">{String(sessionsQuery.error)}</p>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-muted/60 text-left text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">PID</th>
                  <th className="px-3 py-2 font-medium">Benutzer</th>
                  <th className="px-3 py-2 font-medium">Datenbank</th>
                  <th className="px-3 py-2 font-medium">Client-Adresse</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Laufzeit</th>
                  <th className="px-3 py-2 font-medium">Aktuelle Abfrage (gekürzt)</th>
                  <th className="px-3 py-2 font-medium">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((session, index) => (
                  <LiveSessionRow
                    key={session.pid}
                    session={session}
                    index={index}
                    now={m.now}
                    selected={m.highlightedPid === session.pid}
                    acting={m.actingPid === session.pid}
                    onSelect={m.selectSession}
                    onStop={(pid) => void m.stopQuery(pid)}
                    onTerminate={(pid) => void m.terminate(pid)}
                    onCopy={m.copyQuery}
                    onOpen={m.openInEditor}
                  />
                ))}
              </tbody>
            </table>
            {filteredSessions.length === 0 && (
              <p className="p-8 text-center text-xs text-muted-foreground">
                Keine Sessions für diese Filter.
              </p>
            )}
            {filteredSessions.length > visible.length && (
              <p className="border-t px-3 py-2 text-center text-[11px] text-muted-foreground">
                {filteredSessions.length - visible.length} weitere Sessions ausgeblendet. Filter
                verwenden, um sie zu finden.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
