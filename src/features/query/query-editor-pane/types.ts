import type { Ref } from "react";

import type { ColumnInfo, TableInfo } from "@/lib/db";
import type { SqlErrorSource } from "@/lib/monaco";
import type { BookmarkSlots } from "@/lib/table-tabs";

export interface QueryEditorApi {
  insertSnippet: (body: string) => void;
  insertText: (text: string) => void;
  focus: () => void;
  action: (id: string) => void;
  format: () => void;
  toggleComment: () => void;
  revealMatch: (line: number, column?: number, length?: number) => void;
  toggleBookmark: () => void;
  gotoBookmark: (direction: "next" | "previous") => void;
}

export interface EditorPosition {
  line: number;
  column: number;
  offset: number;
}

export interface SchemaRegistry {
  schemas: string[];
  tables: TableInfo[];
  columns: ColumnInfo[];
}

export interface EditorHighlight {
  start: number;
  end: number;
}

export interface QueryEditorPaneProps {
  value: string;
  language?: "sql" | "json" | "redis";
  onChange: (value: string) => void;
  onRun: () => void;
  onSave?: () => void;
  onRunSelection?: () => void;
  onRunStatement?: () => void;
  onCheck?: () => void;
  onSelectionChange?: (selectedText: string) => void;
  onCursorChange?: (offset: number) => void;
  onPositionChange?: (position: EditorPosition) => void;
  highlight?: EditorHighlight | null;
  error?: SqlErrorSource | null;
  bookmarks?: number[];
  onBookmarksChange?: (lines: number[]) => void;
  bookmarkSlots?: BookmarkSlots;
  onBookmarkSlotChange?: (slot: number, line: number | null) => void;
  onSearchTabs?: () => void;
  stateKey?: string;
  registry: SchemaRegistry;
  ref?: Ref<QueryEditorApi>;
  className?: string;
}
