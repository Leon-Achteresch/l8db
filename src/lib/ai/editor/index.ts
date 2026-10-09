import "./monaco-ghost";
import "./monaco-codelens";
import type { monaco } from "@/lib/monaco";
import { EditorAiController, type EditorAiOptions } from "./controller";

export type { EditorAiController } from "./controller";

export function attachEditorAi(
  editor: monaco.editor.IStandaloneCodeEditor,
  options: EditorAiOptions,
): EditorAiController {
  return new EditorAiController(editor, options);
}
