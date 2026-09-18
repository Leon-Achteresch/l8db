import { Button } from "@/components/ui/button";
import type { Dataset, ExpertMapping } from "@/lib/dashboards";
import { ColumnSelect } from "../dataset-column-select";

export function ChartExpertMapping({
  mapping: m,
  resultColumns,
  onChange,
}: {
  mapping: ExpertMapping;
  resultColumns: string[];
  onChange: (patch: Partial<Dataset>) => void;
}) {
  const opts = resultColumns.map((c) => ({ ref: c, label: c, type: "" }));
  const setMapping = (patch: Partial<typeof m>) => onChange({ mapping: { ...m, ...patch } });
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">Ordne die Spalten deiner Abfrage zu</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {resultColumns.length
            ? "Deine Abfrage liefert diese Spalten. Sage dem Chart, was was ist."
            : "Sobald deine Abfrage rechts ein Ergebnis zeigt, kannst du hier die Spalten zuordnen."}
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">Wonach wird aufgeteilt? (z. B. Monat oder Land)</p>
        <ColumnSelect
          value={m.dimension}
          onChange={(dimension) => setMapping({ dimension })}
          columns={opts}
          allowNone="Keine Aufteilung"
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">Welche Spalten sind die Zahlen?</p>
        <div className="flex flex-wrap gap-1.5">
          {opts.map((c) => {
            const active = m.metrics.includes(c.ref);
            return (
              <Button
                key={c.ref}
                type="button"
                size="xs"
                variant={active ? "secondary" : "outline"}
                aria-pressed={active}
                onClick={() =>
                  setMapping({
                    metrics: active ? m.metrics.filter((k) => k !== c.ref) : [...m.metrics, c.ref],
                  })
                }
              >
                {c.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">Zweite Aufteilung (für Fluss- und Matrix-Charts)</p>
        <ColumnSelect
          value={m.dimension2}
          onChange={(dimension2) => setMapping({ dimension2 })}
          columns={opts}
          allowNone="Keine"
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">Zeitspalte (für die Zeitraum-Auswahl im Chart)</p>
        <ColumnSelect
          value={m.dateColumn}
          onChange={(dateColumn) => setMapping({ dateColumn })}
          columns={opts}
          allowNone="Keine"
        />
      </div>
    </div>
  );
}
