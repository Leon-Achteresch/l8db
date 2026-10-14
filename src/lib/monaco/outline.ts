import * as monaco from "monaco-editor/editor/editor.api";
import { parsePlsqlMembers } from "@/lib/plsql";

const outlineModels = new WeakSet<monaco.editor.ITextModel>();

export function enablePackageOutline(model: monaco.editor.ITextModel | null): void {
  if (model) outlineModels.add(model);
}

for (const language of ["sql", "plsql"]) {
  monaco.languages.registerDocumentSymbolProvider(language, {
    provideDocumentSymbols: (model) => {
      if (!outlineModels.has(model)) return [];
      return parsePlsqlMembers(model.getValue()).map((member) => {
        const range = new monaco.Range(
          member.line,
          1,
          member.line,
          model.getLineMaxColumn(member.line),
        );
        const fn = member.kind === "FUNCTION";
        return {
          name: member.name,
          detail: fn ? "Funktion" : "Prozedur",
          kind: fn ? monaco.languages.SymbolKind.Function : monaco.languages.SymbolKind.Method,
          tags: [],
          range,
          selectionRange: range,
        };
      });
    },
  });
}
