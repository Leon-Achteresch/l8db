import { type RefObject, useContext, useEffect, useMemo } from "react";
import { useActiveConnection } from "@/lib/connections";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import type { monaco } from "@/lib/monaco";
import { attachHiddenRanges } from "@/lib/monaco/hidden-ranges";
import type { EditorKind } from "../../../packages/extension-api/src";

export interface ExtensionEditorTarget {
  id: string;
  kind: EditorKind;
}

let serial = 0;

export function useExtensionEditorId(scope: string) {
  return useMemo(() => ({ scope, id: `editor-${++serial}` }), [scope]).id;
}

export function useExtensionEditor(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  target: ExtensionEditorTarget | undefined,
) {
  const host = useContext(ExtensionHostContext);
  const connectionKind = useActiveConnection()?.kind ?? "";
  const id = target?.id;
  const kind = target?.kind;

  useEffect(() => {
    const editor = editorRef.current;
    if (!host || !editor || !id || !kind) return;
    const view = attachHiddenRanges(editor, (line) => host.editors.reveal(id, line));
    const registration = host.editors.register(id, {
      kind,
      connectionKind,
      text: () => editor.getValue(),
      lineCount: () => editor.getModel()?.getLineCount() ?? 0,
      watch: (listener) => editor.onDidChangeModelContent(listener),
      hide: view.set,
    });
    return () => {
      registration.dispose();
      view.dispose();
    };
  }, [host, editorRef, id, kind, connectionKind]);
}
