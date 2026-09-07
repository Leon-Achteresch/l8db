import { Minus, Plus } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { SettingsSqlPreview } from "@/features/settings/settings-sql-preview";
import { useActiveConnection } from "@/lib/connections";
import { capabilitiesFor } from "@/lib/providers";
import { type SqlKeywordCase, useSettingsStore } from "@/lib/settings";
import { sqlDialectForKind, sqlDialectLabel, supportsSqlFormatting } from "@/lib/sql-format";

export function SettingsEditorTab() {
  const {
    editorFontSize,
    editorTabSize,
    editorKeywordCase,
    editorWordWrap,
    editorLineNumbers,
    editorMinimap,
    setEditorFontSize,
    setEditorTabSize,
    setEditorKeywordCase,
    setEditorWordWrap,
    setEditorLineNumbers,
    setEditorMinimap,
  } = useSettingsStore();

  const connection = useActiveConnection();
  const dialect = sqlDialectForKind(connection?.kind);
  const formattingAvailable = connection
    ? supportsSqlFormatting(capabilitiesFor(connection.kind).query_language)
    : true;

  const adjustFontSize = (delta: number) => {
    const next = Math.max(10, Math.min(24, editorFontSize + delta));
    setEditorFontSize(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">SQL-Editor</h2>
        <p className="text-xs text-muted-foreground">
          Schriftbild, Formatierung und Verhalten des integrierten Monaco-Editors.
        </p>
      </div>

      <div className="space-y-3">
        <SettingsRow
          title="Schriftgröße"
          description="Größe der Code-Schriftart im Abfrage-Editor (10 bis 24 px)."
        >
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => adjustFontSize(-1)}
              disabled={editorFontSize <= 10}
            >
              <Minus className="size-3.5" />
            </Button>
            <Input
              type="number"
              min={10}
              max={24}
              step={1}
              aria-label="Editor-Schriftgröße"
              value={editorFontSize}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value) && value >= 10 && value <= 24) setEditorFontSize(value);
              }}
              className="h-8 w-12 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => adjustFontSize(1)}
              disabled={editorFontSize >= 24}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Formatter-Dialekt"
          description="Wird aus der aktiven Verbindung abgeleitet und für Dokument- und Auswahlformatierung genutzt."
        >
          <span className="text-xs text-muted-foreground">
            {formattingAvailable
              ? sqlDialectLabel(dialect)
              : "Keine SQL-Formatierung für diesen Provider"}
          </span>
        </SettingsRow>

        <SettingsRow
          title="Einrückungsbreite"
          description="Anzahl der Leerzeichen pro Tabulatorstufe."
        >
          <SegmentedControl
            value={String(editorTabSize)}
            onChange={(val) => setEditorTabSize(Number.parseInt(val, 10))}
            label="Einrückung"
            options={[
              { value: "2", label: "2 Leerzeichen" },
              { value: "4", label: "4 Leerzeichen" },
            ]}
          />
        </SettingsRow>

        <SettingsRow
          title="SQL-Keywords"
          description="Automatische Groß- oder Kleinschreibung beim Formatieren."
        >
          <SegmentedControl
            value={editorKeywordCase}
            onChange={(val) => setEditorKeywordCase(val as SqlKeywordCase)}
            label="Keyword-Schreibweise"
            options={[
              { value: "upper", label: "GROSS" },
              { value: "lower", label: "klein" },
              { value: "preserve", label: "Beibehalten" },
            ]}
          />
        </SettingsRow>

        <SettingsRow
          title="Automatischer Zeilenumbruch"
          description="Lange SQL-Zeilen im Editor automatisch umbrechen."
        >
          <Switch
            checked={editorWordWrap}
            onCheckedChange={setEditorWordWrap}
            aria-label="Zeilenumbruch"
          />
        </SettingsRow>

        <SettingsRow
          title="Zeilennummern"
          description="Nummerierung am linken Rand des Editors anzeigen."
        >
          <Switch
            checked={editorLineNumbers}
            onCheckedChange={setEditorLineNumbers}
            aria-label="Zeilennummern"
          />
        </SettingsRow>

        <SettingsRow
          title="Code-Minimap"
          description="Verkleinerte Übersicht des gesamten SQL-Skripts am rechten Rand."
        >
          <Switch checked={editorMinimap} onCheckedChange={setEditorMinimap} aria-label="Minimap" />
        </SettingsRow>
      </div>

      <div className="pt-2">
        <SettingsSqlPreview />
      </div>
    </div>
  );
}
