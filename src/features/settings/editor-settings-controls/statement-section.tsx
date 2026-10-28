import { Switch } from "@/components/ui/switch";
import { Row } from "./row";
import { Section } from "./section";
import type { Store } from "./types";

export function EditorStatementSection({ store, compact }: { store: Store; compact: boolean }) {
  return (
    <Section
      title="Statements"
      description="Wie Ausführen am Cursor und die Statement-Übersicht Statements abgrenzen."
    >
      <Row
        settingId="editor-blank-line-terminator"
        featureId="settings.editor.blank-line-terminator"
        compact={compact}
      >
        <Switch
          checked={store.editorBlankLineTerminator}
          onCheckedChange={store.setEditorBlankLineTerminator}
          aria-label="Leerzeile beendet Statement"
        />
      </Row>
    </Section>
  );
}
