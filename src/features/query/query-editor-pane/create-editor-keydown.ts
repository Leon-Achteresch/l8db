import { type Hotkey, matchesKeyboardEvent } from "@tanstack/react-hotkeys";

import { commandById, useHotkeysStore } from "@/lib/hotkeys";
import type { monaco } from "@/lib/monaco";

interface EditorKeydownHandlers {
  editor: monaco.editor.IStandaloneCodeEditor;
  setSlotAtCursor: (slot: number) => void;
  gotoSlotLine: (slot: number) => void;
  toggleBookmarkAtCursor: () => void;
  gotoBookmarkLine: (direction: "next" | "previous") => void;
  onRun: () => void;
  onRunSelection: () => void;
  onRunStatement: () => void;
  onCheck: () => void;
  onSave: () => void;
}

export function createEditorKeydown({
  editor,
  setSlotAtCursor,
  gotoSlotLine,
  toggleBookmarkAtCursor,
  gotoBookmarkLine,
  onRun,
  onRunSelection,
  onRunStatement,
  onCheck,
  onSave,
}: EditorKeydownHandlers) {
  return (event: KeyboardEvent) => {
    const slotMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "");
    if (slotMatch && event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        const slot = Number(slotMatch[1]);
        if (event.shiftKey) setSlotAtCursor(slot);
        else gotoSlotLine(slot);
      }
      return;
    }
    const overrides = useHotkeysStore.getState().overrides;
    const actions: Record<string, () => void> = {
      "query.run": onRun,
      "query.runSelection": onRunSelection,
      "query.runStatement": onRunStatement,
      "query.check": onCheck,
      "query.save": onSave,
      "query.format": () => {
        void editor.getAction("l8db.format-sql")?.run();
      },
      "query.comment": () => {
        void editor.getAction("editor.action.commentLine")?.run();
      },
      "query.bookmark": toggleBookmarkAtCursor,
      "query.nextBookmark": () => gotoBookmarkLine("next"),
      "query.prevBookmark": () => gotoBookmarkLine("previous"),
    };
    for (const [id, action] of Object.entries(actions)) {
      const command = commandById(id);
      if (!command) continue;
      const keys =
        overrides[id] === undefined
          ? [command.defaultHotkey, ...(command.aliases ?? [])]
          : [overrides[id]];
      if (!keys.some((key) => key && matchesKeyboardEvent(event, key as Hotkey))) continue;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) action();
      return;
    }
    for (const id of ["query.format", "query.comment"]) {
      const command = commandById(id);
      if (
        command &&
        overrides[id] !== undefined &&
        overrides[id] !== command.defaultHotkey &&
        matchesKeyboardEvent(event, command.defaultHotkey)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
  };
}
