import { monaco } from "@/lib/monaco";
import { parsePlsqlMembers } from "@/lib/plsql";
import { selectForResults } from "@/lib/select-extract";
import { useSnippetsStore } from "@/lib/snippets";
import {
  hoverMarkdown,
  limitMatches,
  memberSuggestions,
  packageForQualifier,
  resolveSymbol,
  type Suggestion,
  type SymbolTarget,
  suggestCompletions,
  tokenAt,
} from "@/lib/sql-intellisense";
import { attached, ctx, gotoUri } from "./context";
import { hoverExtras, openSymbolTarget, packageMembers } from "./symbols";

const COMPLETION_KIND: Record<Suggestion["kind"], monaco.languages.CompletionItemKind> = {
  schema: monaco.languages.CompletionItemKind.Module,
  table: monaco.languages.CompletionItemKind.Class,
  view: monaco.languages.CompletionItemKind.Interface,
  column: monaco.languages.CompletionItemKind.Field,
  function: monaco.languages.CompletionItemKind.Function,
  procedure: monaco.languages.CompletionItemKind.Method,
  package: monaco.languages.CompletionItemKind.Module,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  snippet: monaco.languages.CompletionItemKind.Snippet,
};

const MAX_SUGGESTIONS = 300;

function textBefore(model: monaco.editor.ITextModel, position: monaco.Position) {
  const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const text = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  return { line, text };
}

export function symbolAt(model: monaco.editor.ITextModel, position: monaco.Position) {
  const token = tokenAt(model.getLineContent(position.lineNumber), position.column);
  if (!token) return null;
  const target = resolveSymbol(ctx.registry, token, model.getValue());
  if (!target) return null;
  const range = new monaco.Range(
    position.lineNumber,
    token.startColumn,
    position.lineNumber,
    token.endColumn,
  );
  return { token, target, range };
}

for (const language of ["sql", "plsql"]) {
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ["."],
    async provideCompletionItems(model, position) {
      if (!attached.has(model)) return { suggestions: [] };
      const { line, text } = textBefore(model, position);
      const word = model.getWordUntilPosition(position);
      const wordRange: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const dotRange: monaco.IRange = {
        ...wordRange,
        startColumn: line.lastIndexOf(".") + 2,
        endColumn: position.column,
      };
      const pkg = packageForQualifier(ctx.registry, line);
      const items = pkg
        ? memberSuggestions(await packageMembers(pkg.schema, pkg.name))
        : suggestCompletions(ctx.registry, text, line, useSnippetsStore.getState().snippets);
      const typed = pkg ? "" : word.word;
      const matches = limitMatches(items, typed, MAX_SUGGESTIONS);
      return {
        incomplete: typed !== "" || matches.truncated,
        suggestions: matches.items.map((item) => ({
          label: item.label,
          kind: COMPLETION_KIND[item.kind],
          detail: item.detail,
          documentation: item.documentation,
          filterText: item.filterText,
          insertText: item.insertText,
          insertTextRules: item.snippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          sortText: item.sortText,
          range: item.afterDot ? dotRange : wordRange,
        })),
      };
    },
  });

  monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position) {
      if (!attached.has(model)) return null;
      const symbol = symbolAt(model, position);
      if (!symbol) return null;
      const value = hoverMarkdown(ctx.registry, symbol.target, await hoverExtras(symbol.target));
      return { range: symbol.range, contents: [{ value, supportHtml: false }] };
    },
  });

  monaco.languages.registerDefinitionProvider(language, {
    provideDefinition(model, position) {
      if (!attached.has(model)) return null;
      const symbol = symbolAt(model, position);
      if (!symbol) return null;
      if (symbol.target.kind === "local") {
        const name = symbol.target.name;
        return parsePlsqlMembers(model.getValue())
          .filter((m) => m.name === name)
          .map((m) => ({
            uri: model.uri,
            range: new monaco.Range(m.line, 1, m.line, 1),
            originSelectionRange: symbol.range,
          }));
      }
      let target = symbol.target;
      if (target.kind === "table" && !target.column && language === "plsql") {
        const sql = selectForResults(model.getValue(), model.getOffsetAt(position), ctx.registry);
        if (sql) target = { ...target, sql };
      }
      return {
        uri: gotoUri(target),
        range: new monaco.Range(1, 1, 1, 1),
        originSelectionRange: symbol.range,
      };
    },
  });
}

monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource) {
    if (resource.scheme !== "l8db") return false;
    openSymbolTarget(JSON.parse(resource.query) as SymbolTarget);
    return true;
  },
});
