import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryNotificationToggle } from "../../src/features/query/query-notification-toggle";
import { QueryResultsContent } from "../../src/features/query/query-view/query-results-content";
import { useEditorCursorState } from "../../src/features/query/query-view/use-editor-cursor-state";
import { useQueryExecutionState } from "../../src/features/query/query-view/use-query-execution-state";
import { useRunSql } from "../../src/features/query/query-view/use-run-sql";
import { useConnectionsStore } from "../../src/lib/connections";
import { capabilitiesFor } from "../../src/lib/providers";
import { queryTabScope, tabStateKey, writeTabState } from "../../src/lib/tab-state";
import { useTableTabs } from "../../src/lib/table-tabs";
import "../../src/index.css";

const connection = {
  id: "qol",
  name: "QoL",
  kind: "postgres" as const,
  connectionString: "postgres://localhost/test",
  sslMode: "disable" as const,
};
useConnectionsStore.setState({ connections: [connection], activeId: connection.id });
useTableTabs.setState({
  tabs: [{ kind: "query", id: "qol", title: "QoL", sql: "SELECT * FROM example" }],
  tabsByConnection: {},
});
writeTabState(tabStateKey(queryTabScope("qol"), "classic"), true);

function QueryQolFixture() {
  const [sql, setSql] = useState("SELECT * FROM example");
  const [failureTimings, setFailureTimings] = useState<number[]>([]);
  const exec = useQueryExecutionState("qol");
  const cursor = useEditorCursorState(sql);
  const { runSql } = useRunSql({
    tabId: "qol",
    sql,
    connection,
    database: "test",
    caps: capabilitiesFor("postgres"),
    exec,
    cursor,
    markQueryTabExecuted: () => {},
    setEditorFocus: () => {},
    collectOutput: async () => {},
    runMultiStatement: async () => {},
    askVariables: async () => ({}),
    confirmPreview: async () => true,
  });
  return (
    <main
      style={{ height: "100vh" }}
      className="flex min-h-0 flex-col bg-background text-foreground"
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <h1 className="mr-auto text-sm font-semibold">SQL-Ergebnisse</h1>
        <QueryNotificationToggle />
        <button
          type="button"
          onClick={() => {
            setSql("SELECT * FROM example");
            void runSql("SELECT * FROM example");
          }}
        >
          Erfolgreich ausführen
        </button>
        <button
          type="button"
          onClick={() => {
            setSql("SELECT broken FROM example");
            const started = performance.now();
            void runSql("SELECT broken FROM example").finally(() =>
              requestAnimationFrame(() =>
                setFailureTimings((times) => [...times, performance.now() - started]),
              ),
            );
          }}
        >
          Fehler auslösen
        </button>
      </div>
      <output aria-label="Fehlerlaufzeiten" hidden>
        {JSON.stringify(failureTimings)}
      </output>
      <QueryResultsContent
        exec={exec}
        kind="postgres"
        statusText={null}
        actions={null}
        onRevealError={() => {}}
        sql={sql}
        tables={[]}
        maximized={false}
        onToggleMaximized={() => {}}
        compareOpen={false}
        connectionId="qol"
        database="test"
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <QueryQolFixture />
  </QueryClientProvider>,
);
