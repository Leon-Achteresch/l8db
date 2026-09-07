import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore } from "@/lib/settings";

const ROW_LIMIT_PRESETS = [50, 100, 500, 1000];

export function SettingsDataTab() {
  const {
    rowLimit,
    queryTimeout,
    transactionsEnabled,
    confirmDestructiveQueries,
    highlightNullValues,
    setRowLimit,
    setQueryTimeout,
    setTransactionsEnabled,
    setConfirmDestructiveQueries,
    setHighlightNullValues,
  } = useSettingsStore();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Daten & Abfragen</h2>
        <p className="text-xs text-muted-foreground">
          Abfrageausführung, Sicherheitsnetz und Tabellendarstellung konfigurieren.
        </p>
      </div>

      <div className="space-y-3">
        <SettingsRow
          title="Standard-Zeilenlimit"
          description="Maximale Anzahl abgerufener Datensätze pro Tabelle (10 bis 5000)."
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              {ROW_LIMIT_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={rowLimit === preset ? "secondary" : "outline"}
                  className="h-8 px-2 text-xs"
                  onClick={() => setRowLimit(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
            <Input
              type="number"
              min={10}
              max={5000}
              step={50}
              aria-label="Zeilenlimit"
              value={rowLimit}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value) && value >= 10 && value <= 5000) setRowLimit(value);
              }}
              className="h-8 w-16 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title="Query-Timeout"
          description="Maximale Ausführungszeit für Abfragen vor Abbruch (5 bis 300 Sekunden)."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={5}
              max={300}
              step={5}
              aria-label="Query-Timeout"
              value={queryTimeout}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value) && value >= 5 && value <= 300) setQueryTimeout(value);
              }}
              className="h-8 w-16 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-xs text-muted-foreground">Sekunden</span>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Änderungen als Transaktion (Safe Mode)"
          description="Zeilenänderungen und DML sammeln und erst nach manuellem Commit persistieren."
        >
          <Switch
            checked={transactionsEnabled}
            onCheckedChange={setTransactionsEnabled}
            aria-label="Transaktionen aktivieren"
          />
        </SettingsRow>

        <SettingsRow
          title="Destruktive Abfragen absichern"
          description="Bestätigungsdialog vor DROP TABLE, TRUNCATE oder DELETE ohne WHERE-Klausel."
        >
          <Switch
            checked={confirmDestructiveQueries}
            onCheckedChange={setConfirmDestructiveQueries}
            aria-label="Destruktive Abfragen absichern"
          />
        </SettingsRow>

        <SettingsRow
          title="NULL-Werte hervorheben"
          description="NULL-Werte im Tabellengitter optisch klar von leeren Zeichenketten trennen."
        >
          <Switch
            checked={highlightNullValues}
            onCheckedChange={setHighlightNullValues}
            aria-label="NULL-Werte hervorheben"
          />
        </SettingsRow>
      </div>
    </div>
  );
}
