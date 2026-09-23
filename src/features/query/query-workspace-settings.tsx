import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      <div className="flex items-center justify-between gap-4 text-sm">
        Ergebnisansicht
        <Select
          value={String(workspace.resultView)}
          onValueChange={(selectedValue) => {
            workspace.update({ resultView: selectedValue as "table" | "json" });
          }}
        >
          <SelectTrigger className={selectClass} aria-label="Ergebnisansicht">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="table">Tabelle</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        Aufteilung
        <Select
          value={String(workspace.layout)}
          onValueChange={(selectedValue) => {
            workspace.update({ layout: selectedValue as "vertical" | "horizontal" });
          }}
        >
          <SelectTrigger className={selectClass} aria-label="Aufteilung">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vertical">Ergebnisse unten</SelectItem>
            <SelectItem value="horizontal">Ergebnisse rechts</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        Cursor
        <Select
          value={String(workspace.cursorStyle)}
          onValueChange={(selectedValue) => {
            workspace.update({ cursorStyle: selectedValue as typeof workspace.cursorStyle });
          }}
        >
          <SelectTrigger className={selectClass} aria-label="Cursor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="line">Linie</SelectItem>
            <SelectItem value="block">Block</SelectItem>
            <SelectItem value="underline">Unterstrich</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        Cursor-Animation
        <Select
          value={String(workspace.cursorBlinking)}
          onValueChange={(selectedValue) => {
            workspace.update({
              cursorBlinking: selectedValue as typeof workspace.cursorBlinking,
            });
          }}
        >
          <SelectTrigger className={selectClass} aria-label="Cursor-Animation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="smooth">Sanft</SelectItem>
            <SelectItem value="blink">Blinkend</SelectItem>
            <SelectItem value="solid">Keine</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        Schriftgröße der Ergebnisse
        <Select
          value={String(workspace.resultFontSize)}
          onValueChange={(selectedValue) => {
            workspace.update({ resultFontSize: Number(selectedValue) });
          }}
        >
          <SelectTrigger className={selectClass} aria-label="Schriftgröße der Ergebnisse">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[11, 12, 13, 14, 16].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        Zeilenhöhe der Ergebnisse
        <Select
          value={String(workspace.resultRowHeight)}
          onValueChange={(selectedValue) => {
            workspace.update({ resultRowHeight: Number(selectedValue) });
          }}
        >
          <SelectTrigger className={selectClass} aria-label="Zeilenhöhe der Ergebnisse">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[26, 29, 34, 40, 48].map((height) => (
              <SelectItem key={height} value={String(height)}>
                {height} px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        Spaltenbreite der Ergebnisse
        <Select
          value={String(workspace.resultColumnWidth)}
          onValueChange={(selectedValue) => {
            workspace.update({ resultColumnWidth: Number(selectedValue) });
          }}
        >
          <SelectTrigger className={selectClass} aria-label="Spaltenbreite der Ergebnisse">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[100, 150, 200, 280, 360, 480].map((width) => (
              <SelectItem key={width} value={String(width)}>
                {width} px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
        <div className="flex items-center justify-between gap-4 text-sm">
          Standard für Ausführen
          <Select
            value={String(workspace.runTarget)}
            onValueChange={(selectedValue) => {
              workspace.update({ runTarget: selectedValue as typeof workspace.runTarget });
            }}
          >
            <SelectTrigger className={selectClass} aria-label="Standard für Ausführen">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="selection-or-all">Auswahl, sonst alles</SelectItem>
              <SelectItem value="selection-or-statement">Auswahl, sonst Statement</SelectItem>
              <SelectItem value="all">Immer gesamter Editor</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
