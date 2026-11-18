import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryView } from "@/features/query/query-view";
import { useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { ExtensionManager } from "@/lib/extensions/manager";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { SandboxRuntime } from "@/lib/extensions/sandbox-runtime";
import { finishManagedTransaction } from "@/lib/managed-transactions";
import { monaco } from "@/lib/monaco";
import { useProvidersStore } from "@/lib/providers";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useSettingsStore } from "@/lib/settings";
import { queryTabScope, tabStateKey, writeTabState } from "@/lib/tab-state";
import { useTableTabs } from "@/lib/table-tabs";
import { type ActiveTransaction, useTransactionStore } from "@/lib/transactions";
import "@/index.css";

const options = new URLSearchParams(location.search);
const reference = options.has("pgvector");
const transactionContext = options.has("postgres-transaction");
const postgres = reference || transactionContext;
useProvidersStore.setState({ loaded: true });
useConnectionsStore.setState({
  activeId: "format-fixture",
  connections: [
    {
      id: "format-fixture",
      name: "Fixture",
      kind: postgres ? "postgres" : "mssql",
      connectionString: postgres ? "postgresql://127.0.0.1/format" : "mssql://127.0.0.1/format",
      sslMode: "disable",
      editorMetadataPrefetch: false,
    },
    ...(postgres
      ? [
          {
            id: "mysql",
            name: "MySQL fixture",
            kind: "mysql" as const,
            connectionString: "mysql://127.0.0.1/format",
            sslMode: "disable" as const,
            editorMetadataPrefetch: false,
          },
        ]
      : []),
  ],
});
useSettingsStore.setState({
  editorKeywordCase: "upper",
  editorTabSize: 4,
  editorFormatLinesBetweenQueries: 1,
  editorFormatDenseOperators: true,
  editorFormatNewlineBeforeSemicolon: false,
});
useQueryWorkspace.getState().update({ navigatorVisible: false });
const store = useTableTabs.getState();
const first = store.openQueryTab();
const second = store.openQueryTab();
store.updateQuerySql(first, postgres ? "SELECT a <-> b FROM items;" : "select [id] from [orders];");
store.updateQuerySql(
  second,
  postgres ? "SELECT a <#> b FROM other;" : "select [other] from [items];",
);

function activeEditor() {
  const editor = monaco.editor
    .getEditors()
    .find((item) => item.getDomNode()?.closest("[data-fixture-query]"));
  if (!editor) throw Error("Fixture editor is not mounted");
  return editor;
}

let selectTab: (tabId: string) => void;
Object.assign(window, {
  sqlFormatReviewFixture: {
    read: () => activeEditor().getValue(),
    focused: () => activeEditor().hasTextFocus(),
    setEol: (crlf: boolean) =>
      activeEditor()
        .getModel()
        ?.setEOL(crlf ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF),
    edit: (sql: string) => {
      const editor = activeEditor();
      const model = editor.getModel();
      if (!model) throw Error("Missing SQL model");
      editor.pushUndoStop();
      editor.executeEdits("fixture", [{ range: model.getFullModelRange(), text: sql }]);
      editor.pushUndoStop();
      editor.setPosition({ lineNumber: 1, column: 1 });
    },
    select: (start: number, end: number) => {
      const editor = activeEditor();
      const model = editor.getModel();
      if (!model) throw Error("Missing SQL model");
      editor.setSelection(
        monaco.Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end)),
      );
    },
    selection: () => {
      const editor = activeEditor();
      const selection = editor.getSelection();
      return selection ? editor.getModel()?.getValueInRange(selection) : undefined;
    },
    hover: async (offset: number) => {
      const editor = activeEditor();
      const model = editor.getModel();
      if (!model) throw Error("Missing SQL model");
      editor.focus();
      editor.setPosition(model.getPositionAt(offset));
      await editor.getAction("editor.action.showHover")?.run();
    },
    setProvider: (id: "format-fixture" | "mysql" | null) =>
      useConnectionsStore.getState().setActiveId(id),
    setDatabase: (database: string) =>
      useDbSelectionStore.getState().setDatabase("format-fixture", database),
    compare: () => {
      const models = monaco.editor.getDiffEditors()[0]?.getModel();
      return models ? [models.original.getValue(), models.modified.getValue()] : null;
    },
    switchTab: () => selectTab(second),
  },
  ...(transactionContext && {
    postgresReadContextFixture: {
      setTransactions: (transactions: Pick<ActiveTransaction, "txId" | "database" | "scope">[]) =>
        useTransactionStore.setState({
          transactions: transactions.map((transaction) => ({
            ...transaction,
            connectionId: "format-fixture",
            connectionName: "Fixture",
            changes: [],
            startedAt: 0,
          })),
        }),
      finish: finishManagedTransaction,
      seedPreviousResult: () => {
        const scope = queryTabScope(first);
        const sql = "SELECT 'Voriger Stand' AS value;";
        writeTabState(tabStateKey(scope, "executedSql"), sql);
        writeTabState(tabStateKey(scope, "resultOrigin"), {
          sql,
          at: 1,
          connectionId: "format-fixture",
          database: "format",
        });
        writeTabState(tabStateKey(scope, "result"), {
          columns: ["value"],
          rows: [{ value: "Voriger Stand" }],
          rows_affected: null,
          execution_time_ms: 1,
        });
      },
    },
  }),
});

function FormatReviewFixture() {
  const [tab, setTab] = useState(first);
  selectTab = setTab;
  return (
    <div data-fixture-query className="flex h-dvh min-h-0 flex-col">
      <QueryView tabId={tab} />
    </div>
  );
}

const extensions = new ExtensionManager(
  { list: async () => [] } as unknown as ConstructorParameters<typeof ExtensionManager>[0],
  new SandboxRuntime(),
  {} as ConstructorParameters<typeof ExtensionManager>[2],
  "0.7.0",
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const route = createRootRoute({ component: FormatReviewFixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory() });
const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
createRoot(root).render(
  <ExtensionHostContext.Provider value={extensions}>
    <ThemeProvider attribute="class" defaultTheme="system">
      <TooltipProvider>
        <HotkeysProvider>
          <QueryClientProvider client={client}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </HotkeysProvider>
      </TooltipProvider>
    </ThemeProvider>
  </ExtensionHostContext.Provider>,
);
