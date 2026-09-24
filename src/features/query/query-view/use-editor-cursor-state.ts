import { useRef, useState } from "react";

import { createEditorPositionStore } from "./editor-position-store";

export function useEditorCursorState(sql: string) {
  const [selectedSql, setSelectedSql] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const editorSqlRef = useRef(sql);
  editorSqlRef.current = sql;
  const cursorOffsetRef = useRef(cursorOffset);
  cursorOffsetRef.current = cursorOffset;
  const [positionStore] = useState(createEditorPositionStore);

  return {
    selectedSql,
    setSelectedSql,
    cursorOffset,
    setCursorOffset,
    editorSqlRef,
    cursorOffsetRef,
    positionStore,
    setCursorPosition: positionStore.set,
  };
}

export type EditorCursorState = ReturnType<typeof useEditorCursorState>;
