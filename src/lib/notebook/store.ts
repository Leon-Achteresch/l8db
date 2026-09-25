import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import {
  type NotebookCell,
  type NotebookCellType,
  type NotebookDoc,
  type NotebookOutput,
  newCell,
  newNotebook,
} from "./model";

export interface RecentNotebook {
  path: string;
  name: string;
  openedAt: number;
}

const MAX_RECENT = 12;

interface NotebookState {
  doc: NotebookDoc;
  filePath: string | null;
  dirty: boolean;
  restored: boolean;
  outputs: Record<string, NotebookOutput>;
  running: Record<string, string | true>;
  recent: RecentNotebook[];
  load: (doc: NotebookDoc, outputs: Record<string, NotebookOutput>, path: string | null) => void;
  reset: (connectionId: string | null) => void;
  patchDoc: (patch: Partial<NotebookDoc>) => void;
  updateCell: (id: string, update: (cell: NotebookCell) => NotebookCell) => void;
  addCell: (type: NotebookCellType, index: number) => string;
  removeCell: (id: string) => void;
  moveCell: (id: string, delta: number) => void;
  setOutput: (id: string, output: NotebookOutput | null) => void;
  setRunning: (id: string, job: string | true | null) => void;
  markSaved: (path: string) => void;
  forgetRecent: (path: string) => void;
  dismissRestored: () => void;
}

function withRecent(recent: RecentNotebook[], path: string, name: string): RecentNotebook[] {
  return [{ path, name, openedAt: Date.now() }, ...recent.filter((r) => r.path !== path)].slice(
    0,
    MAX_RECENT,
  );
}

export const useNotebookStore = create<NotebookState>()(
  persist(
    (set) => ({
      doc: newNotebook(),
      filePath: null,
      dirty: false,
      restored: false,
      outputs: {},
      running: {},
      recent: [],
      load: (doc, outputs, path) =>
        set((s) => ({
          doc,
          outputs,
          filePath: path,
          dirty: false,
          restored: false,
          running: {},
          recent: path ? withRecent(s.recent, path, doc.name) : s.recent,
        })),
      reset: (connectionId) =>
        set({
          doc: newNotebook(connectionId),
          outputs: {},
          filePath: null,
          dirty: false,
          restored: false,
          running: {},
        }),
      patchDoc: (patch) => set((s) => ({ doc: { ...s.doc, ...patch }, dirty: true })),
      updateCell: (id, update) =>
        set((s) => ({
          doc: { ...s.doc, cells: s.doc.cells.map((c) => (c.id === id ? update(c) : c)) },
          dirty: true,
        })),
      addCell: (type, index) => {
        const cell = newCell(type);
        set((s) => {
          const cells = [...s.doc.cells];
          cells.splice(Math.max(0, Math.min(index, cells.length)), 0, cell);
          return { doc: { ...s.doc, cells }, dirty: true };
        });
        return cell.id;
      },
      removeCell: (id) =>
        set((s) => {
          const { [id]: _removed, ...outputs } = s.outputs;
          return {
            doc: { ...s.doc, cells: s.doc.cells.filter((c) => c.id !== id) },
            outputs,
            dirty: true,
          };
        }),
      moveCell: (id, delta) =>
        set((s) => {
          const cells = [...s.doc.cells];
          const from = cells.findIndex((c) => c.id === id);
          const to = from + delta;
          if (from < 0 || to < 0 || to >= cells.length) return {};
          const [cell] = cells.splice(from, 1);
          cells.splice(to, 0, cell);
          return { doc: { ...s.doc, cells }, dirty: true };
        }),
      setOutput: (id, output) =>
        set((s) => {
          const { [id]: _previous, ...rest } = s.outputs;
          return { outputs: output ? { ...rest, [id]: output } : rest };
        }),
      setRunning: (id, job) =>
        set((s) => {
          const { [id]: _previous, ...rest } = s.running;
          return { running: job ? { ...rest, [id]: job } : rest };
        }),
      markSaved: (path) =>
        set((s) => ({
          filePath: path,
          dirty: false,
          restored: false,
          recent: withRecent(s.recent, path, s.doc.name),
        })),
      forgetRecent: (path) => set((s) => ({ recent: s.recent.filter((r) => r.path !== path) })),
      dismissRestored: () => set({ restored: false }),
    }),
    {
      name: "l8db.notebook",
      version: 1,
      storage: createBufferedJsonStorage(() => window.localStorage),
      partialize: (state) =>
        ({
          doc: state.doc,
          filePath: state.filePath,
          dirty: state.dirty,
          recent: state.recent,
        }) as unknown as NotebookState,
      onRehydrateStorage: () => (state) => {
        if (state?.dirty) useNotebookStore.setState({ restored: true });
      },
    },
  ),
);
