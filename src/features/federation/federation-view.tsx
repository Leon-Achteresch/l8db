import { DatabaseZapIcon, PlayIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { QueryResultTable } from "@/features/query/query-result-table";
import { SqlEditor } from "@/features/table/sql-editor";
import { formatBytes } from "@/lib/backup";
import {
  FEDERATION_LIMITS,
  type FederationReport,
  type FederationSource,
  queryFederation,
} from "@/lib/db/federation";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { tabStateKey, useTabState } from "@/lib/tab-state";
import { FederationSourceRow } from "./federation-source-row";
import { federationExample, federationProblem, newFederationSource } from "./federation-state";

export function FederationView() {
  const [sources, setSources] = useTabState<FederationSource[]>(
    tabStateKey("federation", "sources"),
    [newFederationSource([])],
  );
  const [sql, setSql] = useTabState(
    tabStateKey("federation", "sql"),
    "SELECT *\nFROM quelle1.kunden\nLIMIT 100;",
  );
  const [report, setReport] = useState<FederationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const job = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const badge = useNewFeatureVisibility<HTMLButtonElement>("query.federation");
  const problem = federationProblem(sources, sql);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      job.current = null;
      abort.current?.abort();
      abort.current = null;
    };
  }, []);

  async function run() {
    if (problem || job.current) return;
    const id = crypto.randomUUID();
    const current = ++generation.current;
    job.current = id;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setCancelling(false);
    setError(null);
    setReport(null);
    try {
      const result = await queryFederation(
        sources,
        sql,
        { jobId: id, queryTimeout: 30 },
        controller.signal,
      );
      if (mounted.current && current === generation.current) setReport(result);
    } catch (cause) {
      if (mounted.current && current === generation.current) setError(String(cause));
    } finally {
      if (job.current === id) {
        job.current = null;
        abort.current = null;
      }
      if (mounted.current && current === generation.current) {
        setRunning(false);
        setCancelling(false);
      }
    }
  }

  function cancel() {
    if (!job.current || cancelling) return;
    setCancelling(true);
    abort.current?.abort();
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="Datenbankübergreifende SQL-Abfragen"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-4">
        <DatabaseZapIcon className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold">Datenbankübergreifend abfragen</h1>
          <p className="text-xs text-muted-foreground">
            Tabellen mehrerer Verbindungen mit SELECT und JOIN gemeinsam auswerten.
          </p>
        </div>
        {running ? (
          <Button size="sm" variant="outline" disabled={cancelling} onClick={cancel}>
            <SquareIcon className="size-3.5" />
            {cancelling ? "Wird abgebrochen…" : "Abbrechen"}
          </Button>
        ) : (
          <Button
            ref={badge.ref}
            size="sm"
            disabled={Boolean(problem)}
            disabledReason={problem}
            onClick={() => void run()}
          >
            <PlayIcon className="size-3.5" />
            Abfrage ausführen{badge.isNew && <NewBadge />}
          </Button>
        )}
      </header>
      <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-auto border-b p-4">
        {sources.map((source, index) => (
          <FederationSourceRow
            key={index}
            source={source}
            index={index}
            disabled={running}
            onChange={(next) =>
              setSources((current) =>
                current.map((entry, position) => (position === index ? next : entry)),
              )
            }
            onRemove={() =>
              setSources((current) => current.filter((_, position) => position !== index))
            }
          />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={running || sources.length >= FEDERATION_LIMITS.sources}
            onClick={() => setSources((current) => [...current, newFederationSource(current)])}
          >
            <PlusIcon className="size-3" />
            Quelle hinzufügen
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={running}
            onClick={() => setSql(federationExample(sources))}
          >
            SQL-Beispiel einsetzen
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Bis zu 8 Quelltabellen · 50.000 Zeilen je Tabelle · 100.000 insgesamt · 64 MiB
            Quelldaten
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          SQL-Dialekt: SQLite. Quellen werden nacheinander gelesen, ohne gemeinsamen Snapshot.
          Maskierte Quellspalten werden vor der Auswertung durch NULL ersetzt; JOINs und Aggregate
          berücksichtigen diese Ersatzwerte.
        </p>
      </div>
      <div className="h-44 min-h-28 shrink-0 border-b px-4 py-2">
        <SqlEditor
          value={sql}
          onChange={setSql}
          readOnly={running}
          onModSubmit={() => void run()}
          placeholder="SELECT … FROM quelle1.kunden JOIN quelle2.bestellungen …"
        />
      </div>
      {report && (
        <p
          role="status"
          className="shrink-0 border-b px-4 py-2 text-xs tabular-nums text-muted-foreground"
        >
          {report.sourceRows.toLocaleString("de-DE")} Quellzeilen ·{" "}
          {formatBytes(report.sourceBytes)} · {report.sourceReads} Daten-Leseoperationen ·{" "}
          {report.durationMs.toLocaleString("de-DE")} ms
          {report.sources.some((source) => source.maskedColumns.length > 0)
            ? " · Quellspalten maskiert"
            : ""}
          {report.result.truncated ? " · Ergebnis auf 10.000 Zeilen gekürzt" : ""}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <QueryResultTable
          result={report?.result ?? null}
          isLoading={running}
          error={error}
          kind="sqlite"
          masked
          timestampMenu={false}
        />
      </div>
    </section>
  );
}
