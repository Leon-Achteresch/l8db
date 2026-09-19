import { SegmentedControl } from "@/components/motion/segmented-control";
import { Switch } from "@/components/ui/switch";
import type { SqlKeywordCase } from "@/lib/settings";
import { Row } from "./row";
import { Section } from "./section";
import type { Store } from "./types";

export function EditorFormattingSection({ store, compact }: { store: Store; compact: boolean }) {
  return (
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
          onChange={(value) => store.setEditorFormatLinesBetweenQueries(Number.parseInt(value, 10))}
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
  );
}
