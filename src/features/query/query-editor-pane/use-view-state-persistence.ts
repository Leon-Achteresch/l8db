import { type RefObject, useEffect } from "react";
import { readViewStates, writeViewState } from "@/lib/editor-view-states";
import type { monaco } from "@/lib/monaco";

export function useViewStatePersistence(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  stateKey: string | undefined,
) {
  useEffect(() => {
    if (stateKey === undefined) return;
    const editor = editorRef.current;
    if (!editor) return;
    const saved = readViewStates()[stateKey];
    if (saved) editor.restoreViewState(saved);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latest: monaco.editor.ICodeEditorViewState | null = null;
    const track = () => {
      latest = editor.saveViewState();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => writeViewState(stateKey, latest), 300);
    };
    const subs = [editor.onDidScrollChange(track), editor.onDidChangeCursorPosition(track)];
    return () => {
      if (timer) clearTimeout(timer);
      for (const sub of subs) sub.dispose();
      const current = editorRef.current;
      const state = current ? current.saveViewState() : latest;
      if (state) writeViewState(stateKey, state);
    };
  }, [stateKey]);
}
