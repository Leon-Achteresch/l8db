import { AnimatePresence } from "motion/react";
import { useEffect } from "react";
import { useSettingsStore } from "@/lib/settings";
import { installShortcutHints, useShortcutHintsStore } from "@/lib/shortcut-hints";
import { ShortcutHintCard } from "./shortcut-hint/shortcut-hint-card";

export function ShortcutHint() {
  const enabled = useSettingsStore((state) => state.shortcutHints);
  const hint = useShortcutHintsStore((state) => state.active);
  const dismiss = useShortcutHintsStore((state) => state.dismiss);

  useEffect(() => {
    if (!enabled) {
      dismiss();
      return;
    }
    return installShortcutHints();
  }, [enabled, dismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center px-4"
    >
      <AnimatePresence>{hint && <ShortcutHintCard key={hint.id} hint={hint} />}</AnimatePresence>
    </div>
  );
}
