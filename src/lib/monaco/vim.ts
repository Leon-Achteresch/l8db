import type * as monacoApi from "monaco-editor/editor/editor.api";

export interface VimCommandHandlers {
  save?: () => void;
  close?: () => void;
}

type HandlerSource = () => VimCommandHandlers;

interface VimExApi {
  defineEx: (name: string, prefix: string, callback: (cm: { editor: object }) => void) => void;
}

const handlerSources = new WeakMap<object, HandlerSource>();
let exCommandsDefined = false;

function handlersFor(cm: { editor: object }): VimCommandHandlers {
  return handlerSources.get(cm.editor)?.() ?? {};
}

export async function attachVimMode(
  editor: monacoApi.editor.IStandaloneCodeEditor,
  statusNode: HTMLElement | null,
  handlers: HandlerSource,
  isActive: () => boolean,
): Promise<{ dispose: () => void } | null> {
  const { initVimMode, VimMode } = await import("monaco-vim");
  if (!isActive()) return null;
  if (!exCommandsDefined) {
    exCommandsDefined = true;
    const vim = (VimMode as unknown as { Vim: VimExApi }).Vim;
    const saveAndClose = (cm: { editor: object }) => {
      const current = handlersFor(cm);
      current.save?.();
      current.close?.();
    };
    vim.defineEx("write", "w", (cm) => handlersFor(cm).save?.());
    vim.defineEx("quit", "q", (cm) => handlersFor(cm).close?.());
    vim.defineEx("wq", "wq", saveAndClose);
    vim.defineEx("xit", "x", saveAndClose);
  }
  handlerSources.set(editor, handlers);
  const adapter = initVimMode(editor as unknown as Parameters<typeof initVimMode>[0], statusNode);
  return {
    dispose: () => {
      adapter.dispose();
      handlerSources.delete(editor);
    },
  };
}
