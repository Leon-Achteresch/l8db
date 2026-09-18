import { useRef, useState } from "react";

export function useEditorCursorState(sql: string) {
  const [selectedSql, setSelectedSql] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const editorSqlRef = useRef(sql);
  editorSqlRef.current = sql;
  const cursorOffsetRef = useRef(cursorOffset);
  cursorOffsetRef.current = cursorOffset;
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1, offset: 0 });

  return {
    selectedSql,
    setSelectedSql,
    cursorOffset,
    setCursorOffset,
    editorSqlRef,
    cursorOffsetRef,
    cursorPosition,
    setCursorPosition,
  };
}

export type EditorCursorState = ReturnType<typeof useEditorCursorState>;
