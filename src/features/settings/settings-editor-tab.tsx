import { EditorSettingsControls } from "@/features/settings/editor-settings-controls";
import { SettingsSqlPreview } from "@/features/settings/settings-sql-preview";
import { useActiveConnection } from "@/lib/connections";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { sqlDialectForKind, supportsSqlFormatting } from "@/lib/sql-format";

export function SettingsEditorTab() {
  const store = useSettingsStore();

  const connection = useActiveConnection();
  const dialect = sqlDialectForKind(connection?.kind);
  const formattingAvailable = connection
    ? supportsSqlFormatting(capabilitiesFor(connection.kind).query_language)
    : true;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">SQL-Editor</h2>
        <p className="text-xs text-muted-foreground">
          Schriftbild, Darstellung, Autovervollständigung und Formatierung des integrierten
          Monaco-Editors. Gleiche Einstellungen sind auch direkt im Query-Tab änderbar.
        </p>
      </div>

      {!formattingAvailable && (
        <p className="rounded-2xl border border-border/80 bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Der aktive Provider nutzt keine SQL-Syntax — die Formatierungsregeln greifen erst bei
          einer SQL-Verbindung.
        </p>
      )}

      <EditorSettingsControls store={store} />

      <div className="pt-2">
        <SettingsSqlPreview dialect={dialect} />
      </div>
    </div>
  );
}
