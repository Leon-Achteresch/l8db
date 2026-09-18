import { LinkIcon, PencilLineIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveConnection } from "@/lib/connections";
import { type Dataset, emptySimple } from "@/lib/dashboards";
import { supports } from "@/lib/providers";
import { DatasetSourcePicker } from "./dataset-source-picker";
import { SqlEditor } from "./sql-editor";
import { useRelations } from "./use-dataset-query";

const NONE = "__none__";

export function ChartDataStep({
  dataset,
  onChange,
}: {
  dataset: Dataset;
  onChange: (patch: Partial<Dataset>) => void;
}) {
  const connection = useActiveConnection();
  const s = dataset.simple;
  const relations = useRelations(s.schema, s.table);
  const hasFks = supports(connection, "foreign_keys");
  const expert = dataset.mode === "expert";
  const joinValue =
    relations.find(
      (r) =>
        s.join &&
        r.join.table === s.join.table &&
        r.join.fromColumn === s.join.fromColumn &&
        r.join.toColumn === s.join.toColumn,
    )?.key ?? NONE;

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
      {hasFks && s.table && relations.length > 0 && (
        <div className="space-y-2 rounded-xl border bg-card/60 p-4">
          <div className="flex items-center gap-2">
            <LinkIcon className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold">Verknüpfte Tabelle dazuholen?</h3>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Manche Infos stecken in einer anderen Tabelle, zum Beispiel der Kundenname zur
            Bestellung. Deine Datenbank kennt diese Verbindungen bereits.
          </p>
          <Select
            value={joinValue}
            onValueChange={(v) =>
              onChange({
                simple: { ...s, join: relations.find((r) => r.key === v)?.join ?? null },
              })
            }
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue placeholder="Verknüpfte Tabelle" />
            </SelectTrigger>
            <SelectContent searchable>
              <SelectItem value={NONE}>Nein, nur {s.table}</SelectItem>
              {relations.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
