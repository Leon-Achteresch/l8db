import { Input } from "@/components/ui/input";
import type { ReleaseSafety } from "@/lib/versioning/types";
import { VersioningCheckEditor } from "./versioning-check-editor";
import { VersioningSelect } from "./versioning-select";

export function VersioningSafetyEditor({
  value,
  onChange,
}: {
  value: ReleaseSafety;
  onChange: (value: ReleaseSafety) => void;
}) {
  return (
    <div className="space-y-4">
      <VersioningSelect
        label="Migrationsphase"
        value={value.phase}
        onChange={(phase) => onChange({ ...value, phase: phase as ReleaseSafety["phase"] })}
        options={[
          { value: "expand", label: "Expand · kompatibel erweitern" },
          { value: "backfill", label: "Backfill · Daten übertragen" },
          { value: "contract", label: "Contract · Altbestand entfernen" },
          { value: "custom", label: "Individuelle Änderung" },
        ]}
      />
      <VersioningSelect
        label="Anwendungsbetrieb"
        value={value.compatibility}
        onChange={(compatibility) =>
          onChange({ ...value, compatibility: compatibility as ReleaseSafety["compatibility"] })
        }
        options={[
          { value: "online", label: "Mit laufender Anwendung" },
          { value: "maintenance", label: "Wartungsfenster erforderlich" },
        ]}
      />
      <textarea
        aria-label="Betriebsplan"
        value={value.notes}
        onChange={(event) => onChange({ ...value, notes: event.target.value })}
        className="min-h-24 w-full resize-y rounded-lg bg-muted/40 p-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="Kompatible App-Versionen, Backfill, Wiederherstellung und bei Oracle der Umgang mit bestehenden Sessions …"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs" htmlFor="vcs-lock-timeout">
          Sperrwartezeit (ms)
          <Input
            id="vcs-lock-timeout"
            type="number"
            min={100}
            max={60000}
            value={value.lockTimeoutMs}
            onChange={(event) => onChange({ ...value, lockTimeoutMs: Number(event.target.value) })}
          />
        </label>
        <label className="space-y-1 text-xs" htmlFor="vcs-statement-timeout">
          SQL-Zeitlimit (ms)
          <Input
            id="vcs-statement-timeout"
            type="number"
            min={100}
            max={3600000}
            value={value.statementTimeoutMs}
            onChange={(event) =>
              onChange({ ...value, statementTimeoutMs: Number(event.target.value) })
            }
          />
        </label>
      </div>
      <VersioningCheckEditor
        label="Vorprüfung"
        value={value.preconditions}
        onChange={(preconditions) => onChange({ ...value, preconditions })}
      />
      <VersioningCheckEditor
        label="Nachprüfung"
        value={value.postconditions}
        onChange={(postconditions) => onChange({ ...value, postconditions })}
      />
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Jede SELECT-Prüfung liefert genau einen Wert. Keine Kundendaten werden gespeichert. Für
        Produktion sind Betriebsplan und Nachprüfung erforderlich. Oracle-Zeitlimit gilt je
        Datenbankaufruf.
      </p>
    </div>
  );
}
