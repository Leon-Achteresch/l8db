import { CopyIcon, LightbulbIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { adviseIndexes, type ExplainNode, type IndexAdvice } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { showCopiedMessage } from "@/lib/workspace-status";

interface IndexAdvisorPanelProps {
  plan: ExplainNode;
  connectionString: string;
  database: string | null;
}

export function IndexAdvisorPanel({ plan, connectionString, database }: IndexAdvisorPanelProps) {
  const feature = useNewFeatureVisibility<HTMLElement>("query.analysis.index-advisor");
  const [state, setState] = useState<{
    plan: ExplainNode;
    loading: boolean;
    advice: IndexAdvice[] | null;
    error: string | null;
  } | null>(null);
  const current = state?.plan === plan ? state : null;

  const load = async () => {
    setState({ plan, loading: true, advice: null, error: null });
    try {
      const advice = await adviseIndexes("postgres", connectionString, database, plan);
      setState({ plan, loading: false, advice, error: null });
    } catch (error) {
      setState({ plan, loading: false, advice: null, error: String(error) });
    }
  };

  return (
    <section
      ref={feature.ref}
      className="rounded-md border bg-background p-3"
      aria-label="Index-Berater"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <LightbulbIcon className="size-3.5" /> Index-Berater {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Prüft selektive Scans anhand von Planschätzungen, Tabellenstatistik und vorhandenen
            Indizes.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={current?.loading} onClick={() => void load()}>
          {current?.loading && <LoaderCircleIcon className="size-3.5 animate-spin" />}
          {current?.advice ? "Erneut prüfen" : "Indizes prüfen"}
        </Button>
      </div>
      {current?.error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {current.error}
        </p>
      )}
      {current?.advice?.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Keine ausreichend begründeten Indexkandidaten gefunden.
        </p>
      )}
      {current?.advice && current.advice.length > 0 && (
        <div className="mt-3 space-y-2">
          {current.advice.map((item) => (
            <div
              key={`${item.schema}.${item.table}.${item.column}`}
              className="rounded border p-2 text-xs"
            >
              <div className="font-medium">
                {item.schema}.{item.table} · {item.column}
              </div>
              <div className="mt-1 text-muted-foreground">
                Geschätzt {item.estimatedResultRows.toLocaleString("de-DE")} von{" "}
                {item.estimatedTableRows.toLocaleString("de-DE")} Zeilen ·{" "}
                {Math.round(item.selectivity * 100)} %
              </div>
              <div className="mt-2 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1">
                  {item.sql}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  title="SQL kopieren"
                  onClick={() =>
                    void copyText(item.sql).then(() => showCopiedMessage("SQL kopiert."))
                  }
                >
                  <CopyIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Vorschläge vor Ausführung mit realer Last und Schreibkosten prüfen. Es wird kein Index
            automatisch erstellt.
          </p>
        </div>
      )}
    </section>
  );
}
