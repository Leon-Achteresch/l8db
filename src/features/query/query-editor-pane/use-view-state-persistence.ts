import { type RefObject, useEffect } from "react";

import type { monaco } from "@/lib/monaco";

import { readViewStates, writeViewState } from "./editor-utils";

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
    const sub = editor.onDidScrollChange(() => {
      latest = editor.saveViewState();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => writeViewState(stateKey, latest), 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.dispose();
      const current = editorRef.current;
      const state = current ? current.saveViewState() : latest;
      if (state) writeViewState(stateKey, state);
    };
  }, [stateKey]);
}
