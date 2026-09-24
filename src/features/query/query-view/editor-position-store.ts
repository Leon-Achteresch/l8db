import type { EditorPosition } from "@/features/query/query-editor-pane";

export interface EditorPositionStore {
  get: () => EditorPosition;
  set: (position: EditorPosition) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createEditorPositionStore(): EditorPositionStore {
  let current: EditorPosition = { line: 1, column: 1, offset: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (position) => {
      if (
        position.line === current.line &&
        position.column === current.column &&
        position.offset === current.offset
      )
        return;
      current = position;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
