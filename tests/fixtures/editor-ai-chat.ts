import { InlineEditSession } from "../../src/lib/ai/editor/inline-edit";
import { monaco } from "../../src/lib/monaco";

declare global {
  interface Window {
    runChatEdits: (
      original: string,
      edits: string[],
    ) => Promise<{ values: string[]; pending: number[]; rejected: string }>;
  }
}

const host = document.getElementById("host") as HTMLElement;

window.runChatEdits = async (original, edits) => {
  const editor = monaco.editor.create(host, { value: original, language: "sql" });
  try {
    const session = new InlineEditSession(
      editor,
      crypto.randomUUID(),
      { action: "chat", start: 0, end: original.length, instruction: "KI-Chat" },
      () => {},
    );
    const values: string[] = [];
    const pending: number[] = [];
    for (const next of edits) {
      const problem = await session.applyChat(next, "KI-Chat");
      if (problem) throw new Error(problem);
      values.push(editor.getModel()?.getValue() ?? "");
      pending.push(session.getSnapshot().pending);
    }
    session.rejectAll();
    return { values, pending, rejected: editor.getModel()?.getValue() ?? "" };
  } finally {
    editor.dispose();
  }
};
