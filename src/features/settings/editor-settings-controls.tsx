import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { EDITOR_FONT_PRESETS, formatRulers, parseRulersInput } from "@/lib/editor-options";
import type {
  EditorAcceptSuggestionOnEnter,
  EditorFontFamily,
  EditorTabCompletion,
  EditorWhitespace,
  EditorWrappingIndent,
  SqlKeywordCase,
  useSettingsStore,
} from "@/lib/settings";

type Store = ReturnType<typeof useSettingsStore.getState>;

interface SectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  compact,
  children,
}: {
  title: string;
  description: string;
  compact: boolean;
  children: ReactNode;
}) {
  if (!compact) {
    return (
      <SettingsRow title={title} description={description}>
        {children}
      </SettingsRow>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  );
}

function SliderValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
      {value}
      {unit}
    </span>
  );
}

const WHITESPACE_OPTIONS: { value: EditorWhitespace; label: string }[] = [
  { value: "none", label: "Aus" },
  { value: "boundary", label: "Wortgrenzen" },
  { value: "selection", label: "In Auswahl" },
  { value: "trailing", label: "Zeilenenden" },
  { value: "all", label: "Alle" },
];

const WRAPPING_INDENT_OPTIONS: { value: EditorWrappingIndent; label: string }[] = [
  { value: "same", label: "Gleich" },
  { value: "indent", label: "Eingerückt" },
  { value: "deepIndent", label: "Tief" },
];

const ACCEPT_ON_ENTER_OPTIONS: { value: EditorAcceptSuggestionOnEnter; label: string }[] = [
  { value: "on", label: "Immer" },
  { value: "smart", label: "Smart" },
  { value: "off", label: "Nie" },
];

const TAB_COMPLETION_OPTIONS: { value: EditorTabCompletion; label: string }[] = [
  { value: "off", label: "Aus" },
  { value: "onlySnippets", label: "Nur Snippets" },
  { value: "on", label: "An" },
];

function RulersInput({ store, compact }: { store: Store; compact: boolean }) {
  const [text, setText] = useState(() => formatRulers(store.editorRulers));
  useEffect(() => {
    setText(formatRulers(store.editorRulers));
  }, [store.editorRulers]);
  return (
    <Row
      title="Lineale"
      description="Vertikale Hilfslinien bei Spalten, z. B. 80, 120. Leer lassen zum Deaktivieren."
      compact={compact}
    >
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => store.setEditorRulers(parseRulersInput(text))}
        onKeyDown={(event) => {
          if (event.key === "Enter") store.setEditorRulers(parseRulersInput(text));
        }}
        placeholder="80, 120"
        aria-label="Editor-Lineale"
        className="h-8 w-28 font-mono text-xs"
      />
    </Row>
  );
}

export function EditorSettingsControls({
  store,
  compact = false,
}: {
  store: Store;
  compact?: boolean;
}) {
  return (
    <div className="space-y-5">
      <Section title="Schriftbild" description="Schriftart, Größe und Zeilenabstand des Editors.">
        <Row title="Schriftart" description="Code-Schriftart für den SQL-Editor." compact={compact}>
          <Select
            value={store.editorFontFamily}
            onValueChange={(value) => store.setEditorFontFamily(value as EditorFontFamily)}
          >
            <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Editor-Schriftart">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITOR_FONT_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="Schriftgröße"
          description="Größe der Code-Schriftart (10 bis 24 px)."
          compact={compact}
        >
          <div className="flex w-40 items-center gap-2">
            <Slider
              min={10}
              max={24}
              step={1}
              value={[store.editorFontSize]}
              onValueChange={([value]) => value !== undefined && store.setEditorFontSize(value)}
              aria-label="Editor-Schriftgröße"
            />
            <SliderValue value={String(store.editorFontSize)} unit="px" />
          </div>
        </Row>
        <Row
          title="Ligaturen"
          description="Programmier-Ligaturen der Schriftart nutzen (→, ≠, ⇒)."
          compact={compact}
        >
          <Switch
            checked={store.editorFontLigatures}
            onCheckedChange={store.setEditorFontLigatures}
            aria-label="Schrift-Ligaturen"
          />
        </Row>
        <Row
          title="Zeilenhöhe"
          description="Abstand zwischen den Zeilen als Vielfaches der Schriftgröße."
          compact={compact}
        >
          <div className="flex w-40 items-center gap-2">
            <Slider
              min={1.2}
              max={2.4}
              step={0.1}
              value={[store.editorLineHeight]}
              onValueChange={([value]) => value !== undefined && store.setEditorLineHeight(value)}
              aria-label="Editor-Zeilenhöhe"
            />
            <SliderValue value={store.editorLineHeight.toFixed(1)} unit="×" />
          </div>
        </Row>
        <Row
          title="Einrückungsbreite"
          description="Anzahl der Leerzeichen pro Tabulatorstufe."
          compact={compact}
        >
          <SegmentedControl
            value={String(store.editorTabSize)}
            onChange={(value) => store.setEditorTabSize(Number.parseInt(value, 10))}
            label="Einrückung"
            options={[
              { value: "2", label: "2 Leerzeichen" },
              { value: "4", label: "4 Leerzeichen" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Darstellung" description="Gutter, Hilfslinien und Scroll-Verhalten.">
        <Row
          title="Zeilennummern"
          description="Nummerierung am linken Rand des Editors anzeigen."
          compact={compact}
        >
          <Switch
            checked={store.editorLineNumbers}
            onCheckedChange={store.setEditorLineNumbers}
            aria-label="Zeilennummern"
          />
        </Row>
        <Row
          title="Automatischer Zeilenumbruch"
          description="Lange SQL-Zeilen im Editor automatisch umbrechen."
          compact={compact}
        >
          <Switch
            checked={store.editorWordWrap}
            onCheckedChange={store.setEditorWordWrap}
            aria-label="Zeilenumbruch"
          />
        </Row>
        <Row
          title="Umbruch-Einrückung"
          description="Einrückung umbrochener Fortsetzungszeilen."
          compact={compact}
        >
          <Select
            value={store.editorWrappingIndent}
            onValueChange={(value) => store.setEditorWrappingIndent(value as EditorWrappingIndent)}
          >
            <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Umbruch-Einrückung">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WRAPPING_INDENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="Code-Minimap"
          description="Verkleinerte Übersicht des gesamten SQL-Skripts am rechten Rand."
          compact={compact}
        >
          <Switch
            checked={store.editorMinimap}
            onCheckedChange={store.setEditorMinimap}
            aria-label="Minimap"
          />
        </Row>
        <Row
          title="Minimap-Maßstab"
          description="Darstellungsgröße der Minimap-Vorschau."
          compact={compact}
        >
          <SegmentedControl
            value={String(store.editorMinimapScale)}
            onChange={(value) => store.setEditorMinimapScale(Number.parseInt(value, 10))}
            label="Minimap-Maßstab"
            options={[
              { value: "1", label: "Klein" },
              { value: "2", label: "Mittel" },
              { value: "3", label: "Groß" },
            ]}
          />
        </Row>
        <Row
          title="Klammer-Färbung"
          description="Verschachtelte Klammern in unterschiedlichen Farben darstellen."
          compact={compact}
        >
          <Switch
            checked={store.editorBracketPairColorization}
            onCheckedChange={store.setEditorBracketPairColorization}
            aria-label="Klammer-Färbung"
          />
        </Row>
        <Row
          title="Klammer-Hilfslinien"
          description="Vertikale Führungslinien für Klammerpaare anzeigen."
          compact={compact}
        >
          <Switch
            checked={store.editorGuidesBracketPairs}
            onCheckedChange={store.setEditorGuidesBracketPairs}
            aria-label="Klammer-Hilfslinien"
          />
        </Row>
        <Row
          title="Einrückungs-Hilfslinien"
          description="Vertikale Linien für Einrückungsebenen anzeigen."
          compact={compact}
        >
          <Switch
            checked={store.editorGuidesIndentation}
            onCheckedChange={store.setEditorGuidesIndentation}
            aria-label="Einrückungs-Hilfslinien"
          />
        </Row>
        <Row
          title="Leerzeichen"
          description="Unsichtbare Zeichen (Punkte, Pfeile) einblenden."
          compact={compact}
        >
          <Select
            value={store.editorRenderWhitespace}
            onValueChange={(value) => store.setEditorRenderWhitespace(value as EditorWhitespace)}
          >
            <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Leerzeichen-Anzeige">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHITESPACE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <RulersInput store={store} compact={compact} />
        <Row
          title="Sanftes Scrollen"
          description="Animiertes statt sprunghaftes Scrollen im Editor."
          compact={compact}
        >
          <Switch
            checked={store.editorSmoothScrolling}
            onCheckedChange={store.setEditorSmoothScrolling}
            aria-label="Sanftes Scrollen"
          />
        </Row>
      </Section>

      <Section
        title="Autovervollständigung"
        description="Vorschläge für Tabellen, Spalten, Funktionen und Snippets."
      >
        <Row
          title="Vorschläge beim Tippen"
          description="Vorschlagsliste automatisch während der Eingabe öffnen."
          compact={compact}
        >
          <Switch
            checked={store.editorQuickSuggestions}
            onCheckedChange={store.setEditorQuickSuggestions}
            aria-label="Vorschläge beim Tippen"
          />
        </Row>
        <Row
          title="Trigger-Zeichen"
          description="Vorschläge nach Zeichen wie dem Punkt (schema.tabelle) öffnen."
          compact={compact}
        >
          <Switch
            checked={store.editorSuggestOnTriggerCharacters}
            onCheckedChange={store.setEditorSuggestOnTriggerCharacters}
            aria-label="Trigger-Zeichen"
          />
        </Row>
        <Row
          title="Verzögerung"
          description="Wartezeit bis Vorschläge erscheinen (0 bis 500 ms)."
          compact={compact}
        >
          <div className="flex w-40 items-center gap-2">
            <Slider
              min={0}
              max={500}
              step={10}
              value={[store.editorSuggestDelay]}
              onValueChange={([value]) => value !== undefined && store.setEditorSuggestDelay(value)}
              aria-label="Vorschlags-Verzögerung"
            />
            <SliderValue value={String(store.editorSuggestDelay)} unit="ms" />
          </div>
        </Row>
        <Row
          title="Enter übernimmt Vorschlag"
          description="Markierter Vorschlag wird mit Enter eingefügt."
          compact={compact}
        >
          <Select
            value={store.editorAcceptSuggestionOnEnter}
            onValueChange={(value) =>
              store.setEditorAcceptSuggestionOnEnter(value as EditorAcceptSuggestionOnEnter)
            }
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-40 text-xs"
              aria-label="Enter übernimmt Vorschlag"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCEPT_ON_ENTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="Tab-Vervollständigung"
          description="Vorschläge zusätzlich per Tab-Taste einfügen."
          compact={compact}
        >
          <Select
            value={store.editorTabCompletion}
            onValueChange={(value) => store.setEditorTabCompletion(value as EditorTabCompletion)}
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-40 text-xs"
              aria-label="Tab-Vervollständigung"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAB_COMPLETION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="Parameter-Hinweise"
          description="Signatur-Hilfe bei Funktionen wie SUBSTRING(…) einblenden."
          compact={compact}
        >
          <Switch
            checked={store.editorParameterHints}
            onCheckedChange={store.setEditorParameterHints}
            aria-label="Parameter-Hinweise"
          />
        </Row>
      </Section>

      <Section title="Formatierung" description="Verhalten von Umschalt+Alt+F und Auto-Format.">
        <Row
          title="SQL-Keywords"
          description="Automatische Groß- oder Kleinschreibung beim Formatieren."
          compact={compact}
        >
          <SegmentedControl
            value={store.editorKeywordCase}
            onChange={(value) => store.setEditorKeywordCase(value as SqlKeywordCase)}
            label="Keyword-Schreibweise"
            options={[
              { value: "upper", label: "GROSS" },
              { value: "lower", label: "klein" },
              { value: "preserve", label: "Beibehalten" },
            ]}
          />
        </Row>
        <Row
          title="Kompakte Operatoren"
          description="Operatoren ohne Leerzeichen formatieren (a=1 statt a = 1)."
          compact={compact}
        >
          <Switch
            checked={store.editorFormatDenseOperators}
            onCheckedChange={store.setEditorFormatDenseOperators}
            aria-label="Kompakte Operatoren"
          />
        </Row>
        <Row
          title="Umbruch vor Semikolon"
          description="Jedes Statement mit Zeilenumbruch vor dem Semikolon beenden."
          compact={compact}
        >
          <Switch
            checked={store.editorFormatNewlineBeforeSemicolon}
            onCheckedChange={store.setEditorFormatNewlineBeforeSemicolon}
            aria-label="Umbruch vor Semikolon"
          />
        </Row>
        <Row
          title="Leerzeilen zwischen Queries"
          description="Abstand zwischen einzelnen Statements nach dem Formatieren."
          compact={compact}
        >
          <SegmentedControl
            value={String(store.editorFormatLinesBetweenQueries)}
            onChange={(value) =>
              store.setEditorFormatLinesBetweenQueries(Number.parseInt(value, 10))
            }
            label="Leerzeilen zwischen Queries"
            options={[
              { value: "1", label: "1 Zeile" },
              { value: "2", label: "2 Zeilen" },
            ]}
          />
        </Row>
        <Row
          title="Formatieren beim Einfügen"
          description="Eingefügten SQL-Code automatisch formatieren."
          compact={compact}
        >
          <Switch
            checked={store.editorFormatOnPaste}
            onCheckedChange={store.setEditorFormatOnPaste}
            aria-label="Formatieren beim Einfügen"
          />
        </Row>
        <Row
          title="Formatieren beim Tippen"
          description="Zeile beim Setzen des Semikolons automatisch formatieren."
          compact={compact}
        >
          <Switch
            checked={store.editorFormatOnType}
            onCheckedChange={store.setEditorFormatOnType}
            aria-label="Formatieren beim Tippen"
          />
        </Row>
      </Section>
    </div>
  );
}
