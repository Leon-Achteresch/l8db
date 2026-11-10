import { onHotkeyAction } from "@/lib/hotkeys/actions";
import { openLinkFromClipboard, openSharedTabLinkText } from "@/lib/shared-tab-open";
import { containsSharedTabLink } from "@/lib/shared-tabs";

const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='grid'], [role='treegrid'], [data-grid-scroll], [data-tour='data-grid'], .cm-editor, .monaco-editor";
const PALETTE_INPUT = "[role='dialog'] input[role='combobox']";

function isElement(target: EventTarget | null): target is Element {
  return typeof (target as Element | null)?.closest === "function";
}

export function sharedTabPasteText(target: EventTarget | null, text: string): string | null {
  if (!containsSharedTabLink(text)) return null;
  const element = isElement(target) ? target : null;
  if (!element?.closest(EDITABLE)) return text;
  return element.matches(PALETTE_INPUT) && /^l8db:\/\/tab\/[A-Za-z0-9_-]+\/?$/i.test(text.trim())
    ? text
    : null;
}

function handlePaste(event: ClipboardEvent) {
  if (event.defaultPrevented) return;
  const text = sharedTabPasteText(event.target, event.clipboardData?.getData("text/plain") ?? "");
  if (text === null) return;
  event.preventDefault();
  if (isElement(event.target) && event.target.matches(PALETTE_INPUT))
    event.target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  void openSharedTabLinkText(text);
}

export function listenForSharedTabLinks(): () => void {
  document.addEventListener("paste", handlePaste);
  const off = onHotkeyAction("tab.openLink", () => void openLinkFromClipboard());
  return () => {
    document.removeEventListener("paste", handlePaste);
    off();
  };
}
