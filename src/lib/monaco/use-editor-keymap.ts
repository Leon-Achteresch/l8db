import type * as monacoApi from "monaco-editor/editor/editor.api";
import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useSettingsStore } from "@/lib/settings";
import { attachVimMode, type VimCommandHandlers } from "./vim";

export function useEditorKeymap(
  editorRef: RefObject<monacoApi.editor.IStandaloneCodeEditor | null>,
  statusRef: RefObject<HTMLElement | null>,
  handlers: VimCommandHandlers = {},
): boolean {
  const keymap = useSettingsStore((s) => s.editorKeymap);
  const handlersRef = useRef(handlers);
  const detachRef = useRef<(() => void) | null>(null);
  handlersRef.current = handlers;

  useEffect(() => {
    const editor = editorRef.current;
    if (keymap !== "vim" || !editor) return;
    let disposed = false;
    void attachVimMode(
      editor,
      statusRef.current,
      () => handlersRef.current,
      () => !disposed,
    ).then((vim) => {
      if (vim) detachRef.current = vim.dispose;
    });
    return () => {
      disposed = true;
      detachRef.current?.();
      detachRef.current = null;
    };
  }, [keymap, editorRef, statusRef]);

  useLayoutEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  return keymap === "vim";
}
