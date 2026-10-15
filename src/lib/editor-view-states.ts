import type { monaco } from "@/lib/monaco";

const VIEW_STATE_KEY = "l8db.editor-view-state";
export const VIEW_STATE_LIMIT = 100;

export function readViewStates(): Record<string, monaco.editor.ICodeEditorViewState> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_STATE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function writeViewState(key: string, state: monaco.editor.ICodeEditorViewState | null) {
  const all = readViewStates();
  delete all[key];
  if (state) all[key] = state;
  const keys = Object.keys(all);
  for (const oldest of keys.slice(0, Math.max(0, keys.length - VIEW_STATE_LIMIT))) {
    delete all[oldest];
  }
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(all));
  } catch {}
}
