import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryResultTable } from "../../src/features/query/query-result-table";
import { initAppearance } from "../../src/lib/appearance";
import type { QueryResult } from "../../src/lib/db";

initAppearance();

const element = document.getElementById("root");
if (!element) throw new Error("Grid fixture root is missing");
const root = createRoot(element);
const queryClient = new QueryClient();
const controls: {
  replace: ((generation: number, columnCount: number) => void) | null;
  unmount: () => void;
} = { replace: null, unmount: () => root.unmount() };

(window as unknown as { gridLifecycle: typeof controls }).gridLifecycle = controls;

function App() {
  const [result, setResult] = useState<QueryResult | null>(null);
  useEffect(() => {
    controls.replace = (generation, columnCount) => {
      const columns = ["id", ...Array.from({ length: columnCount - 1 }, (_, i) => `col_${i}`)];
      setResult({
        columns,
        rows: Array.from({ length: 5_000 }, (_, row) =>
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              index === 0 ? `${generation}:${row}` : `value ${generation}:${row * 31 + index}`,
            ]),
          ),
        ),
        rows_affected: 5_000,
        execution_time_ms: 0,
      });
    };
    return () => {
      controls.replace = null;
    };
  }, []);
  return <QueryResultTable result={result} isLoading={false} error={null} />;
}

root.render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
