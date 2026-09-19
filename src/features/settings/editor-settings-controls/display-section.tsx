import { SegmentedControl } from "@/components/motion/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { EditorWhitespace, EditorWrappingIndent } from "@/lib/settings";
import { WHITESPACE_OPTIONS, WRAPPING_INDENT_OPTIONS } from "./options";
import { Row } from "./row";
import { RulersInput } from "./rulers-input";
import { Section } from "./section";
import type { Store } from "./types";

export function EditorDisplaySection({ store, compact }: { store: Store; compact: boolean }) {
  return (
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
  );
}
