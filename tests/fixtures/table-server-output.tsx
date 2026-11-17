import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { ResultTabs } from "@/features/query/query-view/result-tabs";
import { useServerOutput } from "@/features/query/query-view/use-server-output";
import { ServerOutputPanel } from "@/features/query/server-output-panel";
import { TableServerOutput } from "@/features/table/table-view/table-server-output";
import type { SavedConnection } from "@/lib/connections";
import { FALLBACK_PROVIDERS, POSTGRES_CAPABILITIES, useProvidersStore } from "@/lib/providers";
import { withTableServerOutput } from "@/lib/table-server-output";
import "@/index.css";

const connection: SavedConnection = {
  id: "fixture-output",
  kind: "postgres",
  name: "Fixture",
  connectionString: "postgresql://synthetic.invalid/fixture",
  sslMode: "disable",
};
useProvidersStore.setState({ loaded: true, providers: [FALLBACK_PROVIDERS[0]] });

function Fixture() {
  const [database, setDatabase] = useState("alpha");
  const [outcome, setOutcome] = useState({ text: "", count: 0 });
  const output = useServerOutput(connection, database, POSTGRES_CAPABILITIES, false);
  const tabs = (
    <ResultTabs
      connectionId={connection.id}
      label="Query-Ausgabe"
      outputOpen={output.outputOpen}
      onOutputOpenChange={output.setOutputOpen}
    />
  );

  const operate = async () => {
    const status = await withTableServerOutput(
      connection,
      database,
      database,
      async () => "Grid-Erfolg",
    );
    setOutcome(({ count }) => ({ count: count + 1, text: `${database}: ${status}` }));
  };

  return (
    <main className="p-4">
      <TableServerOutput
        key={JSON.stringify([connection.id, database])}
        connection={connection}
        database={database}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDatabase("alpha")}>Alpha</Button>
        <Button onClick={() => setDatabase("beta")}>Beta</Button>
        <Button onClick={() => void operate()}>Grid-Erfolg auslösen</Button>
      </div>
      <output aria-label="Grid-Ergebnis">{outcome.text}</output>
      <output aria-label="Grid-Operationen">{outcome.count}</output>
      <section aria-label="Query-Ansicht" className="h-44">
        {output.outputOpen ? (
          <ServerOutputPanel
            connectionId={connection.id}
            enabled={output.outputEnabled}
            busy={output.outputBusy}
            onToggle={output.handleToggleServerOutput}
            tabs={tabs}
          />
        ) : (
          <>
            {tabs}
            <p>Query-Ergebnis geschlossen</p>
          </>
        )}
      </section>
      <Toaster />
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
