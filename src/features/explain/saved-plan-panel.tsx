import { FileJsonIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExplainNodeCard } from "@/features/query/explain-node-card";
import { formatCapturedAt, type SavedExplainPlan } from "@/lib/explain-file";

export interface LoadedPlan {
  path: string;
  fileName: string;
  data: SavedExplainPlan;
}

interface SavedPlanPanelProps {
  label: string;
  loaded: LoadedPlan | null;
  error: string | null;
  busy: boolean;
  onOpen: () => void;
  onClear: () => void;
}

export function SavedPlanPanel({
  label,
  loaded,
  error,
  busy,
  onOpen,
  onClear,
}: SavedPlanPanelProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className="text-xs font-semibold">{label}</span>
        {loaded && (
          <Badge variant={loaded.data.mode === "ANALYZE" ? "default" : "secondary"}>
            {loaded.data.mode === "ANALYZE" ? "ANALYZE (gemessen)" : "EXPLAIN (geschätzt)"}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-xs"
          onClick={onOpen}
          disabled={busy}
        >
          <FileJsonIcon className="size-3.5" />
          {loaded ? "Andere Datei" : "Datei öffnen"}
        </Button>
        {loaded && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onClear}
            title="Plan entfernen"
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>

      {error && <p className="border-b px-3 py-2 text-xs text-destructive">{error}</p>}

      {!loaded && !error && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          Keine Plandatei geladen. Gespeicherte Pläne (.l8plan.json) lassen sich ohne aktive
          Verbindung öffnen.
        </p>
      )}

      {loaded && (
        <div className="flex min-h-0 flex-1 flex-col">
          <dl className="grid shrink-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b px-3 py-2 text-xs">
            <dt className="text-muted-foreground">Quelle</dt>
            <dd className="truncate font-mono" title={loaded.path}>
              {loaded.fileName}
            </dd>
            <dt className="text-muted-foreground">Erfasst</dt>
            <dd>{formatCapturedAt(loaded.data.capturedAt)}</dd>
            <dt className="text-muted-foreground">Verbindung</dt>
            <dd>{loaded.data.connectionName || "unbekannt"}</dd>
            <dt className="text-muted-foreground">Datenbank</dt>
            <dd>
              {loaded.data.database ?? "unbekannt"}
              {loaded.data.databaseKind ? ` (${loaded.data.databaseKind})` : ""}
            </dd>
          </dl>
          <pre className="max-h-32 shrink-0 overflow-auto border-b px-3 py-2 font-mono text-[11px] whitespace-pre-wrap">
            {loaded.data.sql}
          </pre>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            <ExplainNodeCard node={loaded.data.plan} depth={0} />
          </div>
        </div>
      )}
    </div>
  );
}
