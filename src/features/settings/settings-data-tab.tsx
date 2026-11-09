import { Link } from "@tanstack/react-router";
import { ArrowRightLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MultiTargetSettingsRow } from "@/features/settings/multi-target-settings-row";
import { SettingsNumberInput } from "@/features/settings/settings-number-input";
import { SettingsRow } from "@/features/settings/settings-row";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useSettingsStore } from "@/lib/settings";
import { useTransactionStore } from "@/lib/transactions";

const ROW_LIMIT_PRESETS = [50, 100, 500, 1000];

export function SettingsDataTab() {
  const {
    rowLimit,
    queryTimeout,
    transactionsEnabled,
    transactionsPerTable,
    confirmDestructiveQueries,
    highlightNullValues,
    setRowLimit,
    setQueryTimeout,
    setTransactionsEnabled,
    setTransactionsPerTable,
    setConfirmDestructiveQueries,
    setHighlightNullValues,
  } = useSettingsStore();
  const historyLimit = useQueryHistoryStore((state) => state.retentionLimit);
  const setHistoryLimit = useQueryHistoryStore((state) => state.setRetentionLimit);
  const hasTransactions = useTransactionStore((state) => state.transactions.length > 0);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold tracking-tight">Daten & Abfragen</h2>

      <div className="space-y-3">
        <SettingsRow settingId="history-limit">
          <Input
            type="number"
            min={50}
            max={5000}
            step={50}
            aria-label="Query-Verlauf je Verbindung"
            value={historyLimit}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value >= 50 && value <= 5000) setHistoryLimit(value);
            }}
            className="h-8 w-24 text-xs"
          />
        </SettingsRow>
        <SettingsRow settingId="row-limit">
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
            <SettingsNumberInput
              min={10}
              max={5000}
              step={50}
              aria-label="Zeilenlimit"
              value={rowLimit}
              onCommit={setRowLimit}
              className="w-16"
            />
          </div>
        </SettingsRow>

        <SettingsRow settingId="timeout">
          <div className="flex items-center gap-2">
            <SettingsNumberInput
              min={5}
              max={300}
              step={5}
              aria-label="Query-Timeout"
              value={queryTimeout}
              onCommit={setQueryTimeout}
              className="w-16"
            />
            <span className="text-xs text-muted-foreground">Sekunden</span>
          </div>
        </SettingsRow>

        <SettingsRow settingId="transactions">
          <Switch
            checked={transactionsEnabled}
            onCheckedChange={setTransactionsEnabled}
            aria-label="Transaktionen aktivieren"
          />
        </SettingsRow>

        <SettingsRow settingId="transactions-per-table" resetDisabled={hasTransactions}>
          <Switch
            checked={transactionsPerTable}
            onCheckedChange={setTransactionsPerTable}
            disabled={hasTransactions || !transactionsEnabled}
            aria-label="Transaktionen pro Tabelle"
          />
        </SettingsRow>

        <SettingsRow settingId="destructive-confirm">
          <Switch
            checked={confirmDestructiveQueries}
            onCheckedChange={setConfirmDestructiveQueries}
            aria-label="Destruktive Abfragen absichern"
          />
        </SettingsRow>

        <MultiTargetSettingsRow />

        <SettingsRow settingId="null-values">
          <Switch
            checked={highlightNullValues}
            onCheckedChange={setHighlightNullValues}
            aria-label="NULL-Werte hervorheben"
          />
        </SettingsRow>

        <SettingsRow settingId="transfer" featureId="settings.data.transfer">
          <Button variant="outline" size="sm" asChild>
            <Link to="/transfer">
              <ArrowRightLeftIcon className="size-3.5" />
              <span>Transfer öffnen</span>
            </Link>
          </Button>
        </SettingsRow>
      </div>
    </div>
  );
}
