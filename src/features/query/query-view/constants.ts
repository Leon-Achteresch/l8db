import {
  CommandIcon,
  FoldVerticalIcon,
  HashIcon,
  type LucideIcon,
  MessageSquareCodeIcon,
  ReplaceIcon,
  SearchIcon,
  SquareCodeIcon,
  TextSelectIcon,
  UnfoldVerticalIcon,
} from "lucide-react";
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

export const EDITOR_ACTIONS: [string, string, LucideIcon][] = [
  ["actions.find", "Suchen", SearchIcon],
  ["editor.action.startFindReplaceAction", "Suchen und ersetzen", ReplaceIcon],
  ["editor.action.quickCommand", "Editor-Befehlspalette", CommandIcon],
  ["editor.action.gotoLine", "Gehe zu Zeile", HashIcon],
  ["editor.action.commentLine", "Zeilenkommentar umschalten", MessageSquareCodeIcon],
  ["editor.action.blockComment", "Blockkommentar umschalten", SquareCodeIcon],
  ["editor.action.foldAll", "Alles einklappen", FoldVerticalIcon],
  ["editor.action.unfoldAll", "Alles aufklappen", UnfoldVerticalIcon],
  ["editor.action.selectHighlights", "Alle Vorkommen auswählen", TextSelectIcon],
];
