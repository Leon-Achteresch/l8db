import { create } from "zustand";

export interface EditorCheckpoint {
  id: string;
  label: string;
  at: number;
  before: string;
}

const MAX_CHECKPOINTS = 20;
const MAX_TOTAL_CHARS = 8_000_000;
export const MAX_GLOBAL_CHARS = 24_000_000;

interface CheckpointState {
  byEditor: Record<string, EditorCheckpoint[]>;
  add: (editorId: string, checkpoint: Omit<EditorCheckpoint, "id" | "at">) => string;
  clear: (editorId: string) => void;
}

function bounded(list: EditorCheckpoint[]): EditorCheckpoint[] {
  const next = list.slice(-MAX_CHECKPOINTS);
  let total = 0;
  for (let index = next.length - 1; index >= 0; index--) {
    total += next[index].before.length;
    if (total > MAX_TOTAL_CHARS) return next.slice(index + 1);
  }
  return next;
}

function globallyBounded(byEditor: Record<string, EditorCheckpoint[]>) {
  let total = 0;
  for (const list of Object.values(byEditor))
    for (const entry of list) total += entry.before.length;
  if (total <= MAX_GLOBAL_CHARS) return byEditor;
  const oldest = Object.entries(byEditor)
    .flatMap(([editorId, list]) => list.map((entry) => ({ editorId, entry })))
    .sort((a, b) => a.entry.at - b.entry.at);
  const dropped = new Set<string>();
  for (const { entry } of oldest) {
    if (total <= MAX_GLOBAL_CHARS) break;
    total -= entry.before.length;
    dropped.add(entry.id);
  }
  const next: Record<string, EditorCheckpoint[]> = {};
  for (const [editorId, list] of Object.entries(byEditor)) {
    const kept = list.filter((entry) => !dropped.has(entry.id));
    if (kept.length) next[editorId] = kept;
  }
  return next;
}

export const useEditorCheckpoints = create<CheckpointState>((set) => ({
  byEditor: {},
  add: (editorId, checkpoint) => {
    const id = crypto.randomUUID();
    set((state) => ({
      byEditor: globallyBounded({
        ...state.byEditor,
        [editorId]: bounded([
          ...(state.byEditor[editorId] ?? []),
          { ...checkpoint, id, at: Date.now() },
        ]),
      }),
    }));
    return id;
  },
  clear: (editorId) =>
    set((state) => {
      const { [editorId]: _removed, ...rest } = state.byEditor;
      return { byEditor: rest };
    }),
}));
