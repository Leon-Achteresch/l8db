import { SegmentedControl } from "@/components/motion/segmented-control";
import { Switch } from "@/components/ui/switch";
import type { SqlKeywordCase } from "@/lib/settings";
import { Row } from "./row";
import { Section } from "./section";
import type { Store } from "./types";

export function EditorFormattingSection({ store, compact }: { store: Store; compact: boolean }) {
  return (
    <Section title="Formatierung" description="Verhalten von Umschalt+Alt+F und Auto-Format.">
      <Row settingId="keyword-case" compact={compact}>
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
      <Row settingId="editor-format-dense-operators" compact={compact}>
        <Switch
          checked={store.editorFormatDenseOperators}
          onCheckedChange={store.setEditorFormatDenseOperators}
          aria-label="Kompakte Operatoren"
        />
      </Row>
      <Row settingId="editor-format-newline-before-semicolon" compact={compact}>
        <Switch
          checked={store.editorFormatNewlineBeforeSemicolon}
          onCheckedChange={store.setEditorFormatNewlineBeforeSemicolon}
          aria-label="Umbruch vor Semikolon"
        />
      </Row>
      <Row settingId="format-lines-between-queries" compact={compact}>
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
      <Row settingId="editor-format-on-paste" compact={compact}>
        <Switch
          checked={store.editorFormatOnPaste}
          onCheckedChange={store.setEditorFormatOnPaste}
          aria-label="Formatieren beim Einfügen"
        />
      </Row>
      <Row settingId="editor-format-on-type" compact={compact}>
        <Switch
          checked={store.editorFormatOnType}
          onCheckedChange={store.setEditorFormatOnType}
          aria-label="Formatieren beim Tippen"
        />
      </Row>
    </Section>
  );
}
