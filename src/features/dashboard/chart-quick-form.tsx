import { Table2Icon } from "lucide-react";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Dataset, type DatasetShape, emptySimple, type Widget } from "@/lib/dashboards";
import { useTablesQuery, useViewsQuery } from "@/lib/queries";
import { ChartVisualBuilder } from "./chart-visual-builder";

export function ChartQuickForm({
  dataset,
  widget,
  titlePlaceholder,
  onDataset,
  onWidget,
}: {
  dataset: Dataset;
  widget: Widget;
  shape: DatasetShape;
  titlePlaceholder: string;
  onDataset: (patch: Partial<Dataset>) => void;
  onWidget: (patch: Partial<Widget>) => void;
}) {
  const titleId = useId();
  const simple = dataset.simple;
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const sources = [
    ...(tables.data ?? []).map((source) => ({ ...source, kind: "Tabelle" })),
    ...(views.data ?? []).map((source) => ({ ...source, kind: "View" })),
  ];
  const sourceKey = simple.table ? JSON.stringify([simple.schema, simple.table]) : "";
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Datenquelle</p>
          <Select
            value={sourceKey}
            onValueChange={(value) => {
              const [schema, table] = JSON.parse(value) as [string, string];
              onDataset({ simple: { ...emptySimple(), schema, table } });
            }}
          >
            <SelectTrigger size="sm" className="h-9 w-full text-xs" aria-label="Datenquelle">
              <SelectValue placeholder="Tabelle oder View wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {sources.map((source) => (
                <SelectItem
                  key={`${source.kind}:${source.schema}.${source.name}`}
                  value={JSON.stringify([source.schema, source.name])}
                >
                  <span className="truncate">
                    {source.schema ? `${source.schema}.` : ""}
                    {source.name}
                  </span>
                  <span className="ml-auto pl-2 text-[10px] text-muted-foreground">
                    {source.kind}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label htmlFor={titleId} className="block space-y-1.5 text-xs font-medium">
          <span>Chart-Titel</span>
          <Input
            id={titleId}
            aria-label="Chart-Titel"
            value={widget.title}
            placeholder={titlePlaceholder || "Zum Beispiel Umsatz pro Monat"}
            onChange={(event) => onWidget({ title: event.target.value })}
            className="h-9 text-xs"
          />
        </label>
      </div>
      {simple.table ? (
        <ChartVisualBuilder key={sourceKey} dataset={dataset} onChange={onDataset} />
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-muted/35 p-6">
          <Table2Icon className="size-6 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Starte mit deiner Datenquelle</h2>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            Wähle eine Tabelle oder View. Danach kannst du ihre Felder zu Kennzahlen, Kategorien und
            Filtern zusammensetzen.
          </p>
          {tables.isError || views.isError ? (
            <p role="alert" className="text-xs text-destructive">
              Die Datenquellen konnten nicht vollständig geladen werden. Prüfe deine Verbindung.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
