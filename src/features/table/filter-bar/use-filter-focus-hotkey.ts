import { useHotkey } from "@tanstack/react-hotkeys";
import type { RefObject } from "react";
import { useResolvedHotkey } from "@/lib/hotkeys";
import { useWorkspacePane } from "@/lib/workspace-pane";

const handled = new WeakSet<Event>();
const EDITOR_SELECTOR = ".cm-editor, .monaco-editor, [contenteditable='true']";
const FIELD_SELECTORS = [
  ".cm-content",
  "input, textarea",
  "[role='combobox'], [data-filter-field]",
];
const MAX_FRAMES = 30;

export function focusFilterTarget(root: HTMLElement | null): boolean {
  const target = root?.querySelector<HTMLElement>("[data-filter-focus]");
  if (!target) return false;
  if (target.dataset.filterFocus === "click") {
    target.click();
    return true;
  }
  const field = target.matches(FIELD_SELECTORS.join(", "))
    ? target
    : FIELD_SELECTORS.map((selector) => target.querySelector<HTMLElement>(selector)).find(Boolean);
  if (!field) return false;
  field.focus();
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
  return true;
}

export function useFilterFocusHotkey(
  rootRef: RefObject<HTMLElement | null>,
  reveal?: () => void,
  collapse?: () => void,
) {
  const pane = useWorkspacePane();
  const hotkey = useResolvedHotkey("grid.filter");
  useHotkey(
    hotkey,
    (event) => {
      if (handled.has(event) || (pane && !pane.focused)) return;
      const root = rootRef.current;
      if (!root || root.getClientRects().length === 0) return;
      const target = event.target;
      if (collapse && target instanceof Node && root.contains(target)) {
        handled.add(event);
        event.preventDefault();
        if (target instanceof HTMLElement) target.blur();
        collapse();
        return;
      }
      if (target instanceof Element && target.closest(EDITOR_SELECTOR)) return;
      handled.add(event);
      event.preventDefault();
      reveal?.();
      let frames = MAX_FRAMES;
      const attempt = () => {
        if (focusFilterTarget(rootRef.current) || --frames <= 0) return;
        requestAnimationFrame(attempt);
      };
      attempt();
    },
    { ignoreInputs: false, preventDefault: false, stopPropagation: false },
  );
}
