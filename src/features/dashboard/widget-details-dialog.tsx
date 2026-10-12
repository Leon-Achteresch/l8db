import { CodeIcon, DownloadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import { type DatasetShape, DEFAULT_OPTIONS, DETAIL_LIMIT } from "@/lib/dashboards";
import { exportRowsCsv } from "@/lib/dashboards/csv";
import { applyMasks } from "@/lib/masking";
import { useActiveMasks } from "@/lib/masking-display";
import { DataTable } from "./charts/data-table";
import { useSqlQuery } from "./use-dataset-query";
import { useWidgetDetailsStore } from "./widget-details-store";

const RAW_SHAPE: DatasetShape = { dimension: null, dimension2: null, metrics: [], hasDate: false };
const RAW_OPTIONS = { ...DEFAULT_OPTIONS, totals: false };
const NO_COLUMNS: string[] = [];
const NO_ROWS: Record<string, unknown>[] = [];

export function WidgetDetailsDialog() {
  const request = useWidgetDetailsStore((s) => s.request);
  const close = useWidgetDetailsStore((s) => s.close);
  const [showSql, setShowSql] = useState(false);
  const query = useSqlQuery(request?.sql ?? "");
  const columns = query.data?.columns ?? NO_COLUMNS;
  const { active: masks } = useActiveMasks(columns);
  const raw = query.data?.rows ?? NO_ROWS;
  const rows = useMemo(() => applyMasks(columns, raw, masks), [columns, raw, masks]);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{request?.title ?? "Details"}</DialogTitle>
          <DialogDescription>
            {request?.subtitle}
            {query.isSuccess && ` · ${rows.length}${rows.length >= DETAIL_LIMIT ? "+" : ""} Zeilen`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!query.data || rows.length === 0}
            onClick={async () => {
              if (!query.data || !request) return;
              try {
                if (await exportRowsCsv(request.title, columns, rows))
                  toast.success("CSV exportiert");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Export fehlgeschlagen");
              }
            }}
          >
            <DownloadIcon /> CSV exportieren
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSql((v) => !v)}>
            <CodeIcon /> {showSql ? "SQL ausblenden" : "SQL anzeigen"}
          </Button>
        </div>
        {showSql && request && (
          <pre className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {request.sql}
          </pre>
        )}
        <div className="min-h-64 flex-1 overflow-hidden rounded-md border">
          {query.isError ? (
            <p role="alert" className="p-3 text-xs text-destructive">
              {queryErrorMessage(query.error)}
            </p>
          ) : query.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <div className="grid h-64 place-items-center text-xs text-muted-foreground">
              Keine Zeilen
            </div>
          ) : (
            <div className="h-[60vh]">
              <DataTable rows={rows} shape={RAW_SHAPE} options={RAW_OPTIONS} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
