import { EditorBehaviorSection } from "./editor-settings-controls/behavior-section";
import { EditorDisplaySection } from "./editor-settings-controls/display-section";
import { EditorFormattingSection } from "./editor-settings-controls/formatting-section";
import { EditorKeymapSection } from "./editor-settings-controls/keymap-section";
import type { Store } from "./editor-settings-controls/types";
import { EditorTypographySection } from "./editor-settings-controls/typography-section";

export function EditorSettingsControls({
  store,
  compact = false,
}: {
  store: Store;
  compact?: boolean;
}) {
  return (
    <div className="space-y-5">
      <EditorTypographySection store={store} compact={compact} />

      <EditorDisplaySection store={store} compact={compact} />

      <EditorBehaviorSection store={store} compact={compact} />

      <EditorKeymapSection store={store} compact={compact} />

      <EditorFormattingSection store={store} compact={compact} />
    </div>
  );
}
