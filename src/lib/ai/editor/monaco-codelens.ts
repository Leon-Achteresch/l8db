import { monaco } from "@/lib/monaco";
import { attached } from "@/lib/monaco-intellisense/context";
import { splitSqlStatements } from "@/lib/sql-statements";
import { controllerForModel, editorAiController } from "./controller";
import { currentEditorAiEnvironment } from "./environment";
import { useEditorAiSettings } from "./settings";

export const MAX_LENS_STATEMENTS = 300;
const COMMAND = "l8db.ai.lens";

export function lensOffsets(text: string, dialect?: string, limit = MAX_LENS_STATEMENTS): number[] {
  const offsets: number[] = [];
  for (const statement of splitSqlStatements(text, dialect).statements) {
    if (offsets.length >= limit) break;
    let index = statement.start;
    while (index < statement.end) {
      if (/\s/.test(text[index])) index++;
      else if (text.startsWith("--", index)) {
        const end = text.indexOf("\n", index);
        index = end < 0 ? statement.end : end + 1;
      } else if (text.startsWith("/*", index)) {
        const end = text.indexOf("*/", index + 2);
        index = end < 0 ? statement.end : end + 2;
      } else break;
    }
    if (index < statement.end) offsets.push(index);
  }
  return offsets;
}

const cache = new WeakMap<monaco.editor.ITextModel, { version: number; offsets: number[] }>();
const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>();

useEditorAiSettings.subscribe((state, previous) => {
  if (state.codeLens !== previous.codeLens || state.enabled !== previous.enabled)
    changed.fire(provider);
});

monaco.editor.registerCommand(
  COMMAND,
  (_accessor, editorId: string, action: "explain" | "optimize" | "edit", offset: number) => {
    editorAiController(editorId)?.runAt(offset, action);
  },
);

const provider: monaco.languages.CodeLensProvider = {
  onDidChange: changed.event,
  provideCodeLenses(model) {
    const settings = useEditorAiSettings.getState();
    const controller = controllerForModel(model);
    if (!attached.has(model) || !controller || !settings.enabled || !settings.codeLens)
      return { lenses: [], dispose() {} };
    const version = model.getVersionId();
    let entry = cache.get(model);
    if (!entry || entry.version !== version) {
      entry = {
        version,
        offsets: lensOffsets(model.getValue(), currentEditorAiEnvironment().connection?.kind),
      };
      cache.set(model, entry);
    }
    const lenses = entry.offsets.flatMap((offset) => {
      const position = model.getPositionAt(offset);
      const range = new monaco.Range(position.lineNumber, 1, position.lineNumber, 1);
      return (
        [
          ["explain", "Erklären"],
          ["optimize", "Optimieren"],
          ["edit", "Bearbeiten"],
        ] as const
      ).map(([action, title]) => ({
        range,
        command: { id: COMMAND, title, arguments: [controller.id, action, offset] },
      }));
    });
    return { lenses, dispose() {} };
  },
};

for (const language of ["sql", "plsql"])
  monaco.languages.registerCodeLensProvider(language, provider);
