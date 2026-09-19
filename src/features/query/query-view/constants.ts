import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import type { BookmarkSlots } from "@/lib/table-tabs";

export const MAX_RESULT_ROWS = 1000;
export const EMPTY_BOOKMARKS: number[] = [];
export const EMPTY_BOOKMARK_SLOTS: BookmarkSlots = {};

export const SCRIPT_MODE_NOTE: Record<ScriptRunMode, string> = {
  "existing-transaction": "läuft in offener Transaktion, kein Autocommit",
  "new-transaction": "verwaltete Transaktion, Commit über Transaktionspanel",
  autocommit: "Autocommit je Statement",
};

export const EDITOR_ACTIONS: string[][] = [
  ["actions.find", "Suchen"],
  ["editor.action.startFindReplaceAction", "Suchen und ersetzen"],
  ["editor.action.quickCommand", "Editor-Befehlspalette"],
  ["editor.action.gotoLine", "Gehe zu Zeile"],
  ["editor.action.commentLine", "Zeilenkommentar umschalten"],
  ["editor.action.blockComment", "Blockkommentar umschalten"],
  ["editor.action.foldAll", "Alles einklappen"],
  ["editor.action.unfoldAll", "Alles aufklappen"],
  ["editor.action.selectHighlights", "Alle Vorkommen auswählen"],
];
