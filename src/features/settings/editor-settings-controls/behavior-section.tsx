import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { EditorAcceptSuggestionOnEnter, EditorTabCompletion } from "@/lib/settings";
import { ACCEPT_ON_ENTER_OPTIONS, TAB_COMPLETION_OPTIONS } from "./options";
import { Row } from "./row";
import { Section } from "./section";
import { SliderValue } from "./slider-value";
import type { Store } from "./types";

export function EditorBehaviorSection({ store, compact }: { store: Store; compact: boolean }) {
  return (
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
          <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Tab-Vervollständigung">
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
  );
}
