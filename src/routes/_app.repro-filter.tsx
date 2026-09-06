import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DataTable } from "@/features/table/data-table";

function ReproFilterView() {
  const [lastFilter, setLastFilter] = useState("");
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col p-4">
      <div data-testid="last-filter" className="mb-2 font-mono text-xs">
        last-filter:{lastFilter}
      </div>
      <DataTable
        columns={["id", "name"]}
        data={[
          { id: 1, name: "alpha" },
          { id: 2, name: "beta" },
        ]}
        emptyMessage="Keine Daten."
        sorting={[]}
        onSortingChange={() => {}}
        onApplyFilter={(where) => setLastFilter(where)}
      />
    </div>
  );
}

export const Route = createFileRoute("/_app/repro-filter")({
  component: ReproFilterView,
});
