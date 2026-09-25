import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EditorKeymap } from "@/lib/settings";
import { Row } from "./row";
import { Section } from "./section";
import type { Store } from "./types";

const KEYMAP_OPTIONS: { value: EditorKeymap; label: string }[] = [
  { value: "default", label: "Standard" },
  { value: "vim", label: "Vim" },
];

export function EditorKeymapSection({ store, compact }: { store: Store; compact: boolean }) {
  return (
    <Section
      title="Tastenbelegung"
      description="Vim-Modus mit Statuszeile (NORMAL/INSERT/VISUAL) und Befehlszeile: :w speichert, :q schließt den Tab, :wq beides."
    >
      <Row
        title="Tastaturmodus"
        description="Vim wird erst beim Aktivieren nachgeladen und gilt für alle SQL-Editoren."
        compact={compact}
      >
        <Select
          value={store.editorKeymap}
          onValueChange={(value) => store.setEditorKeymap(value as EditorKeymap)}
        >
          <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Tastaturmodus">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KEYMAP_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </Section>
  );
}
