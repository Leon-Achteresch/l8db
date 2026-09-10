import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { type SavedConnection, useActiveConnection } from "@/lib/connections";
import { fetchTableRows, getFunctionDefinition, listAllColumns } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { monaco } from "@/lib/monaco";
import { packageOid, parsePlsqlMembers } from "@/lib/plsql";
import { useAllSchemaObjectsQuery, useSchemasQuery } from "@/lib/queries";
import { useSnippetsStore } from "@/lib/snippets";
import {
  EMPTY_REGISTRY,
  type HoverExtras,
  hoverMarkdown,
  memberSuggestions,
  packageForQualifier,
  resolveSymbol,
  type SqlObjectRegistry,
  type Suggestion,
  type SymbolTarget,
  suggestCompletions,
  tokenAt,
} from "@/lib/sql-intellisense";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

type Navigate = ReturnType<typeof useNavigate>;

interface IntellisenseContext {
  registry: SqlObjectRegistry;
  connection: SavedConnection | null;
  database: string | null;
  queryClient: QueryClient | null;
  navigate: Navigate | null;
}

let ctx: IntellisenseContext = {
  registry: EMPTY_REGISTRY,
  connection: null,
  database: null,
  queryClient: null,
  navigate: null,
};

const attached = new WeakSet<monaco.editor.ITextModel>();

export function attachSqlIntellisense(
  editor: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable {
  const model = editor.getModel();
  if (model) attached.add(model);
  return {
    dispose() {
      if (model) attached.delete(model);
    },
  };
}

export function useSqlIntellisenseSync(): void {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: objects } = useAllSchemaObjectsQuery();
  const { data: schemas } = useSchemasQuery();
  const { data: columns } = useQuery({
    queryKey: ["all-columns", connection?.id, database],
    queryFn: () =>
      listAllColumns(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: Boolean(connection),
    staleTime: 60_000,
  });

  useEffect(() => {
    ctx = {
      registry: {
        schemas: schemas ?? [],
        tables: objects?.tables ?? [],
        views: objects?.views ?? [],
        columns: columns ?? [],
        functions: objects?.functions ?? [],
        procedures: objects?.procedures ?? [],
      },
      connection,
      database,
      queryClient,
      navigate,
    };
  }, [connection, database, queryClient, navigate, objects, schemas, columns]);
}

async function fetchDefinition(oid: string): Promise<string> {
  const { connection, database, queryClient } = ctx;
  if (!connection || !queryClient) return "";
  return queryClient.fetchQuery({
    queryKey: ["function-definition", connection.id, database, oid],
    queryFn: () =>
      getFunctionDefinition(
        connection.kind,
        effectiveConnectionString(connection),
        oid,
        database ?? undefined,
      ),
  });
}

async function packageMembers(schema: string, name: string) {
  try {
    return parsePlsqlMembers(await fetchDefinition(packageOid(schema, name, "spec")));
  } catch {
    return [];
  }
}

async function hoverExtras(target: SymbolTarget): Promise<HoverExtras> {
  const { connection, database, registry } = ctx;
  if (target.kind === "package") {
    return { members: await packageMembers(target.schema, target.name) };
  }
  if (target.kind === "function" || target.kind === "procedure") {
    const pool = target.kind === "function" ? registry.functions : registry.procedures;
    return { routine: pool.find((fn) => fn.oid === target.oid) };
  }
  if (target.kind === "table" && !target.column && connection) {
    try {
      const rows = await fetchTableRows(
        connection.kind,
        effectiveConnectionString(connection),
        target.schema,
        target.name,
        undefined,
        5,
        0,
        database ?? undefined,
        undefined,
        target.entityType === "view",
      );
      return { rows };
    } catch {
      return {};
    }
  }
  return {};
}

function openSymbolTarget(target: SymbolTarget): void {
  const { navigate } = ctx;
  if (!navigate) return;
  const tabs = useTableTabs.getState();
  if (target.kind === "table") {
    tabs.openTab({ schema: target.schema, table: target.name, entityType: target.entityType });
    void navigate({
      to: "/tables/$schema/$table",
      params: { schema: target.schema, table: target.name },
      search: {
        type: target.entityType === "view" ? ("view" as const) : undefined,
        column: target.column,
      },
    });
    return;
  }
  if (target.kind === "function") {
    tabs.openFunctionTab({ schema: target.schema, name: target.name, oid: target.oid });
    void navigate({
      to: "/functions/$schema/$name",
      params: { schema: target.schema, name: target.name },
      search: { oid: target.oid },
    });
    return;
  }
  if (target.kind === "procedure") {
    tabs.openProcedureTab({ schema: target.schema, name: target.name, oid: target.oid });
    void navigate({
      to: "/procedures/$schema/$name",
      params: { schema: target.schema, name: target.name },
      search: { oid: target.oid },
    });
    return;
  }
  if (target.kind === "package") {
    tabs.openPackageTab({ schema: target.schema, name: target.name });
    void navigate({
      to: "/packages/$schema/$name",
      params: { schema: target.schema, name: target.name },
      search: { part: "body", member: target.member },
    });
  }
}

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

function symbolAt(model: monaco.editor.ITextModel, position: monaco.Position) {
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
      return {
        suggestions: items.map((item) => ({
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
        return {
          uri: model.uri,
          range: new monaco.Range(symbol.target.line, 1, symbol.target.line, 1),
          originSelectionRange: symbol.range,
        };
      }
      return {
        uri: monaco.Uri.from({
          scheme: "l8db",
          path: "/goto",
          query: JSON.stringify(symbol.target),
        }),
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
