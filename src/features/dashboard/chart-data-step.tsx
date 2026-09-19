import { LinkIcon, PencilLineIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { type Dataset, emptySimple } from "@/lib/dashboards";
import { supports } from "@/lib/providers";
import { DatasetSourcePicker } from "./dataset-source-picker";
import { SqlEditor } from "./sql-editor";

export function ChartDataStep({
  dataset,
  onChange,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
}) {
  const connection = useActiveConnection();
  const s = dataset.simple;
  const hasFks = supports(connection, "foreign_keys");
  const expert = dataset.mode === "expert";

  if (expert)
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">Deine eigene SQL-Abfrage</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Schreibe eine SELECT-Abfrage. Die Spalten des Ergebnisses ordnest du im nächsten Schritt
            dem Chart zu.
          </p>
        </div>
        <SqlEditor
          value={dataset.sql}
          onChange={(sql) => onChange({ sql })}
          className="min-h-64 flex-1 rounded-xl border bg-background"
        />
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ mode: "simple", sql: dataset.sql })}
          >
            <TableIcon /> Doch lieber eine Tabelle auswählen
          </Button>
        </div>
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Woher kommen deine Daten?</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Wähle eine Tabelle oder eine View. Eine View ist eine fertig vorbereitete Antwort aus
          deiner Datenbank.
        </p>
      </div>
      <DatasetSourcePicker
        schema={s.schema}
        table={s.table}
        onChange={(schema, table) => onChange({ simple: { ...emptySimple(), schema, table } })}
      />
      {hasFks && s.table && (
        <div className="flex gap-2 rounded-xl border bg-card/60 p-4 text-[11px] leading-relaxed text-muted-foreground">
          <LinkIcon className="size-4 shrink-0" />
          <p>
            Spalten aus verknüpften Tabellen, zum Beispiel der Kundenname zur Bestellung, findest du
            direkt in den Spaltenlisten. Die Verknüpfung wird automatisch hinzugefügt.
          </p>
        </div>
      )}
      <div className="border-t pt-4">
        <Button variant="ghost" size="sm" onClick={() => onChange({ mode: "expert" })}>
          <PencilLineIcon /> Ich möchte selbst SQL schreiben
        </Button>
      </div>
    </div>
  );
}
