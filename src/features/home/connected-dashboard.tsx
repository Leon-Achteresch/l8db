import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Database,
  Eye,
  FunctionSquare,
  Layers,
  ListOrdered,
  Package,
  Plus,
  RefreshCw,
  Search,
  SquareTerminal,
  Table2,
  Workflow,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { connectionSummary, providerFor, queryErrorMessage } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema, useDbSelectionStore } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import {
  useDatabaseOverviewQuery,
  useExtensionsQuery,
  useFunctionsQuery,
  useMaterializedViewsQuery,
  useRefreshConnection,
  useSequencesQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useTableTabs } from "@/lib/table-tabs";
import { DashboardMetric } from "./dashboard-metric";

const TABLE_LIST_LIMIT = 50;

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** index).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB", "TB"][index]}`;
}

export function ConnectedDashboard({ connection }: { connection: SavedConnection }) {
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const functions = useFunctionsQuery();
  const extensions = useExtensionsQuery();
  const sequences = useSequencesQuery();
  const matviews = useMaterializedViewsQuery();
  const overview = useDatabaseOverviewQuery();
  const { refresh, isRefreshing } = useRefreshConnection();
  const history = useQueryHistoryStore((state) => state.entries);
  const recent = history
    .filter((entry) => entry.connectionId === connection.id && entry.database === database)
    .slice(0, 4);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  const provider = providerFor(connection);
  const caps = provider.capabilities;
  const largestSchema = Math.max(
    1,
    ...(overview.data?.schemas.map((entry) => entry.size_bytes) ?? []),
  );
  const matching =
    tables.data?.filter((table) => table.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  const filtered = matching.slice(0, TABLE_LIST_LIMIT);
  const metrics = [
    { label: "Tabellen", query: tables, icon: Database, enabled: true },
    { label: "Views", query: views, icon: Eye, enabled: caps.views },
    { label: "Funktionen", query: functions, icon: FunctionSquare, enabled: caps.functions },
    { label: "Extensions", query: extensions, icon: Package, enabled: caps.extensions },
    { label: "Sequenzen", query: sequences, icon: ListOrdered, enabled: caps.sequences },
    { label: "Mat. Views", query: matviews, icon: Layers, enabled: caps.materialized_views },
  ].filter((metric) => metric.enabled);

  function newQuery() {
    const id = useTableTabs.getState().openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  }

  return (
    <main className="workspace-canvas flex-1 overflow-auto" data-tour="dashboard">
      <motion.div
        layout
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ layout: SPRING_LAYOUT }}
        className="mx-auto max-w-[1400px] px-6 py-8 lg:px-9"
      >
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="eyebrow">Arbeitsplatz</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-[11px] text-muted-foreground">{provider.name}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">{connection.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{database}</span>
              {caps.schemas && (
                <>
                  <span className="size-1 rounded-full bg-border" />
                  <span>Schema {schema}</span>
                </>
              )}
              <span className="size-1 rounded-full bg-border" />
              <span className="max-w-72 truncate">{endpoint.host}</span>
            </p>
          </div>
          <div className="flex items-center gap-2" data-tour="dashboard-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Übersicht aktualisieren"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={newQuery}>
              <Plus className="size-3.5" />
              {caps.query_language === "sql" ? "SQL-Abfrage" : "Abfrage"}
            </Button>
          </div>
        </header>
        <div className="mb-6 flex items-center gap-3">
          <AnimatedBadge
            size="sm"
            status={tables.isError ? "danger" : tables.isPending ? "loading" : "success"}
          >
            {tables.isError
              ? "Verbindung prüfen"
              : tables.isPending
                ? "Objekte laden"
                : "Daten geladen"}
          </AnimatedBadge>
          <span className="text-[11px] text-muted-foreground">
            {connection.ssh?.host ? "SSH-Tunnel · " : ""}TLS{" "}
            {connection.sslMode === "disable" ? "deaktiviert" : connection.sslMode}
          </span>
        </div>
        <section
          aria-label="Datenbankobjekte"
          className="mb-8 grid grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-2xl border bg-card sm:grid-cols-3 xl:grid-cols-6"
        >
          {metrics.map(({ label, query, icon }) => (
            <DashboardMetric
              key={label}
              label={label}
              value={query.data?.length}
              loading={query.isPending}
              error={query.isError}
              icon={icon}
            />
          ))}
        </section>
        <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(270px,1fr)]">
          <div className="min-w-0 space-y-7">
            <section className="overflow-hidden rounded-2xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <h2 className="text-sm font-semibold">
                  Tabellen{" "}
                  <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                    {schema}
                  </span>
                </h2>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                  <Input
                    className="h-7 w-44 rounded-lg pl-8 text-xs"
                    aria-label="Tabellen in der Übersicht suchen"
                    placeholder="Tabelle suchen…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>
              {tables.isPending || (tables.isError && !queryErrorMessage(tables.error)) ? (
                <div className="space-y-4 p-5">
                  {[0, 1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-7 w-full" />
                  ))}
                </div>
              ) : tables.isError ? (
                <div className="p-5">
                  <p role="alert" className="text-xs leading-relaxed text-destructive">
                    {queryErrorMessage(tables.error)}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void tables.refetch()}
                  >
                    Erneut versuchen
                  </Button>
                </div>
              ) : filtered.length ? (
                <div className="max-h-80 overflow-auto divide-y divide-border/60">
                  {filtered.map((table) => (
                    <motion.div
                      key={`${table.schema}.${table.name}`}
                      layout="position"
                      transition={{ layout: SPRING_LAYOUT }}
                    >
                      <Link
                        to="/tables/$schema/$table"
                        params={{ schema: table.schema, table: table.name }}
                        onClick={() =>
                          useTableTabs
                            .getState()
                            .openTab({ schema: table.schema, table: table.name })
                        }
                        className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/60"
                      >
                        <Table2 className="size-4 text-primary/80" />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {table.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{table.schema}</span>
                        <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                      </Link>
                    </motion.div>
                  ))}
                  {matching.length > filtered.length ? (
                    <p className="px-5 py-3 text-[11px] text-muted-foreground">
                      {`… und ${matching.length - filtered.length} weitere. Suche eingrenzen oder Sidebar nutzen.`}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <Table2 className="mx-auto mb-3 size-6 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {search
                      ? "Keine passende Tabelle gefunden."
                      : "Dieses Schema enthält noch keine Tabellen."}
                  </p>
                  {!search && (
                    <Button variant="outline" size="sm" className="mt-4" asChild>
                      <Link to="/create-table">
                        <Plus className="size-3" />
                        Tabelle erstellen
                      </Link>
                    </Button>
                  )}
                </div>
              )}
            </section>
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Letzte Abfragen</h2>
                <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                  <Link to="/query">
                    SQL-Arbeitsplatz
                    <ArrowRight className="size-3" />
                  </Link>
                </Button>
              </div>
              {recent.length ? (
                <div className="divide-y rounded-xl border bg-card">
                  {recent.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                      <SquareTerminal
                        className={`size-4 shrink-0 ${entry.error ? "text-destructive" : "text-primary"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs">{entry.sql}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(entry.ranAt).toLocaleString("de-DE", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}{" "}
                          · {entry.error ? "Fehlgeschlagen" : `${entry.rowCount ?? 0} Zeilen`}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {entry.durationMs == null ? "—" : `${entry.durationMs} ms`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed px-5 py-6 text-xs text-muted-foreground">
                  Deine ausgeführten Abfragen erscheinen hier mit Laufzeit und Ergebnis.
                </p>
              )}
            </section>
          </div>
          <aside className="space-y-6">
            {caps.overview && (
              <section className="rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Speicher & Schemas</h2>
                  <Database className="size-4 text-muted-foreground" />
                </div>
                {overview.isPending || (overview.isError && !queryErrorMessage(overview.error)) ? (
                  <Skeleton className="my-5 h-12 w-28" />
                ) : overview.isError ? (
                  <p role="alert" className="mt-4 text-xs leading-relaxed text-destructive">
                    {queryErrorMessage(overview.error)}
                  </p>
                ) : (
                  overview.data && (
                    <>
                      <p className="mt-4 text-3xl font-medium tracking-tight">
                        {overview.data.size_pretty}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Gesamtgröße von {overview.data.database}
                      </p>
                      <div className="mt-5 space-y-3">
                        {overview.data.schemas.map((entry) => (
                          <button
                            key={entry.schema}
                            type="button"
                            onClick={() =>
                              useDbSelectionStore.getState().setSchema(connection.id, entry.schema)
                            }
                            className="block w-full rounded-lg p-1 text-left hover:bg-muted"
                          >
                            <span className="mb-1.5 flex items-center justify-between text-xs">
                              <span
                                className={
                                  schema === entry.schema ? "font-mono text-primary" : "font-mono"
                                }
                              >
                                {entry.schema}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {entry.table_count} Tabellen · {formatBytes(entry.size_bytes)}
                              </span>
                            </span>
                            <span className="block h-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-primary/60"
                                style={{
                                  width: `${Math.max(1, (entry.size_bytes / largestSchema) * 100)}%`,
                                }}
                              />
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )
                )}
              </section>
            )}
            <section className="rounded-2xl bg-primary/[0.055] p-5">
              <Workflow className="mb-3 size-5 text-primary" />
              <h2 className="text-sm font-semibold">Das große Ganze sehen</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Erkunde Tabellen und ihre Beziehungen im ER-Diagramm.
              </p>
              <Button variant="outline" size="sm" asChild className="mt-4 h-8 text-xs">
                <Link to="/er-diagram">
                  Diagramm öffnen
                  <ArrowRight className="size-3" />
                </Link>
              </Button>
            </section>
            <Link
              to="/connections"
              className="flex items-center justify-between rounded-xl border px-4 py-3 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              Verbindungen verwalten
              <ArrowRight className="size-3.5" />
            </Link>
          </aside>
        </div>
      </motion.div>
    </main>
  );
}
