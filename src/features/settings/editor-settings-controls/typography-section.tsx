import { SegmentedControl } from "@/components/motion/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { EDITOR_FONT_PRESETS } from "@/lib/editor-options";
import type { EditorFontFamily } from "@/lib/settings";
import { Row } from "./row";
import { Section } from "./section";
import { SliderValue } from "./slider-value";
import type { Store } from "./types";

export function EditorTypographySection({ store, compact }: { store: Store; compact: boolean }) {
  return (
    <Section title="Schriftbild" description="Schriftart, Größe und Zeilenabstand des Editors.">
      <Row settingId="editor-font-family" compact={compact}>
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
      <Row settingId="font-size" compact={compact}>
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
      <Row settingId="editor-font-ligatures" compact={compact}>
        <Switch
          checked={store.editorFontLigatures}
          onCheckedChange={store.setEditorFontLigatures}
          aria-label="Schrift-Ligaturen"
        />
      </Row>
      <Row settingId="editor-line-height" compact={compact}>
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
      <Row settingId="tab-size" compact={compact}>
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
  );
}
