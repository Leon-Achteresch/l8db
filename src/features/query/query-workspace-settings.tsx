import { Switch } from "@/components/ui/switch";
import { QUERY_WORKSPACE_PRESETS, useQueryWorkspace } from "@/lib/query-workspace";
import { useSettingsStore } from "@/lib/settings";

export function QueryWorkspaceSettings() {
  const workspace = useQueryWorkspace();
  const settings = useSettingsStore();
  const toggles = [
    [
      "navigatorVisible",
      "Schema-Navigator",
      "Tabellen, Spalten und Statement-Struktur neben dem Editor.",
    ],
    ["toolsVisible", "Werkzeugleiste", "Dateien, Navigation und Analyse einblenden."],
    ["navigationTools", "Navigationswerkzeuge", "Outline, Suche, Ausgabe und Lesezeichen."],
    ["fileTools", "Dateien und Bibliothek", "Speichern, Snippets, Dateien und Verlauf."],
    [
      "analysisTools",
      "Analysewerkzeuge",
      "Explain und Performance-Tests bei unterstützten Datenbanken.",
    ],
    ["statusVisible", "Statusleiste", "Cursorposition, Dialekt und Einrückung anzeigen."],
    ["folding", "Code einklappen", "SQL-Blöcke über den linken Rand einklappen."],
    ["stickyScroll", "Kontext beim Scrollen", "Übergeordnete Codezeilen am oberen Rand halten."],
    ["insertSpaces", "Leerzeichen statt Tabs", "Einrückung mit Leerzeichen einfügen."],
    ["autoClosing", "Klammern und Anführungszeichen", "Paare beim Tippen automatisch schließen."],
    ["highlightLine", "Aktuelle Zeile hervorheben", "Die Cursorzeile im Editor markieren."],
    [
      "scrollBeyondLastLine",
      "Über das Dateiende scrollen",
      "Platz unter der letzten Zeile lassen.",
    ],
    ["stripedRows", "Abwechselnde Ergebniszeilen", "Zeilen im Ergebnisraster dezent absetzen."],
  ] as const;
  const selectClass = "h-8 rounded-md border bg-background px-2 text-xs";
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="font-semibold">Dein Arbeitsplatz</h3>
        <p className="text-xs text-muted-foreground">
          Wird automatisch gespeichert und gilt für alle Query-Tabs.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Arbeitsplatz-Vorlagen">
        {(
          [
            ["focus", "Schreiben", "Mehr Platz für Code"],
            ["develop", "Entwickeln", "Schema neben SQL"],
            ["analyze", "Analysieren", "Ergebnisse rechts"],
          ] as const
        ).map(([id, title, detail]) => (
          <button
            key={id}
            type="button"
            className="rounded-lg border bg-muted/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-ring"
            onClick={() => workspace.update(QUERY_WORKSPACE_PRESETS[id])}
          >
            <span className="block text-xs font-semibold">{title}</span>
            <span className="mt-1 block text-[10px] text-muted-foreground">{detail}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-4 text-sm">
        Editor-Anteil
        <span className="flex items-center gap-3">
          <input
            type="range"
            min="20"
            max="80"
            step="1"
            value={workspace.editorShare}
            onChange={(e) => workspace.update({ editorShare: Number(e.target.value) })}
            className="w-28 accent-primary"
          />
          <span className="w-9 text-right font-mono text-xs">
            {Math.round(workspace.editorShare)}%
          </span>
        </span>
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        Ergebnisansicht
        <select
          className={selectClass}
          value={workspace.resultView}
          onChange={(e) => workspace.update({ resultView: e.target.value as "table" | "json" })}
        >
          <option value="table">Tabelle</option>
          <option value="json">JSON</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        Aufteilung
        <select
          className={selectClass}
          value={workspace.layout}
          onChange={(e) =>
            workspace.update({ layout: e.target.value as "vertical" | "horizontal" })
          }
        >
          <option value="vertical">Ergebnisse unten</option>
          <option value="horizontal">Ergebnisse rechts</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        Cursor
        <select
          className={selectClass}
          value={workspace.cursorStyle}
          onChange={(e) =>
            workspace.update({ cursorStyle: e.target.value as typeof workspace.cursorStyle })
          }
        >
          <option value="line">Linie</option>
          <option value="block">Block</option>
          <option value="underline">Unterstrich</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        Cursor-Animation
        <select
          className={selectClass}
          value={workspace.cursorBlinking}
          onChange={(e) =>
            workspace.update({
              cursorBlinking: e.target.value as typeof workspace.cursorBlinking,
            })
          }
        >
          <option value="smooth">Sanft</option>
          <option value="blink">Blinkend</option>
          <option value="solid">Keine</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        Schriftgröße der Ergebnisse
        <select
          className={selectClass}
          value={workspace.resultFontSize}
          onChange={(e) => workspace.update({ resultFontSize: Number(e.target.value) })}
        >
          {[11, 12, 13, 14, 16].map((size) => (
            <option key={size} value={size}>
              {size} px
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        Zeilenhöhe der Ergebnisse
        <select
          className={selectClass}
          value={workspace.resultRowHeight}
          onChange={(e) => workspace.update({ resultRowHeight: Number(e.target.value) })}
        >
          {[26, 29, 34, 40, 48].map((height) => (
            <option key={height} value={height}>
              {height} px
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        Spaltenbreite der Ergebnisse
        <select
          className={selectClass}
          value={workspace.resultColumnWidth}
          onChange={(e) => workspace.update({ resultColumnWidth: Number(e.target.value) })}
        >
          {[100, 150, 200, 280, 360, 480].map((width) => (
            <option key={width} value={width}>
              {width} px
            </option>
          ))}
        </select>
      </label>
      <div className="divide-y">
        {toggles.map(([key, label, description]) => (
          <label key={key} className="flex cursor-pointer items-center justify-between gap-6 py-3">
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
            </span>
            <Switch
              checked={workspace[key]}
              onCheckedChange={(checked) => workspace.update({ [key]: checked })}
              aria-label={label}
            />
          </label>
        ))}
      </div>
      <div className="space-y-4 border-t pt-4">
        <h3 className="font-semibold">Ausführung</h3>
        <label className="flex items-center justify-between gap-4 text-sm">
          Standard für Ausführen
          <select
            className={selectClass}
            value={workspace.runTarget}
            onChange={(e) =>
              workspace.update({ runTarget: e.target.value as typeof workspace.runTarget })
            }
          >
            <option value="selection-or-all">Auswahl, sonst alles</option>
            <option value="selection-or-statement">Auswahl, sonst Statement</option>
            <option value="all">Immer gesamter Editor</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          Verwaltete Transaktionen
          <Switch
            checked={settings.transactionsEnabled}
            onCheckedChange={settings.setTransactionsEnabled}
          />
        </label>
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={workspace.reset}
      >
        Arbeitsplatz auf Standard zurücksetzen
      </button>
    </div>
  );
}
