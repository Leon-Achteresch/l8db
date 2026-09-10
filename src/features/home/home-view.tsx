import { useEffect } from "react";

import { useNavigate } from "@tanstack/react-router";
import { DatabaseIcon, EyeIcon, FunctionSquareIcon, ListOrderedIcon, PackageIcon, ServerIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import {
  useExtensionsQuery,
  useFunctionsQuery,
  useSequencesQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  isLoading: boolean;
}

function StatCard({ icon, label, value, isLoading }: StatCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-3xl font-semibold tabular-nums">
        {isLoading ? <span className="text-muted-foreground/40">—</span> : (value ?? 0)}
      </span>
    </div>
  );
}

function ConnectedDashboard() {
  const connection = useActiveConnection()!;
  const database = useActiveDatabase();
  const schema = useActiveSchema();

  const { data: tables, isLoading: tablesLoading } = useTablesQuery();
  const { data: views, isLoading: viewsLoading } = useViewsQuery();
  const { data: functions, isLoading: functionsLoading } = useFunctionsQuery();
  const { data: extensions, isLoading: extensionsLoading } = useExtensionsQuery();
  const { data: sequences, isLoading: sequencesLoading } = useSequencesQuery();

  return (
    <div className="flex flex-1 flex-col overflow-auto p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <ServerIcon className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">{connection.name}</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground uppercase">
            {connection.kind}
          </span>
        </div>
        <p className="ml-8 text-sm text-muted-foreground">
          {[database, schema ? `Schema: ${schema}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon={<DatabaseIcon className="size-4" />}
          label="Tabellen"
          value={tables?.length}
          isLoading={tablesLoading}
        />
        <StatCard
          icon={<EyeIcon className="size-4" />}
          label="Views"
          value={views?.length}
          isLoading={viewsLoading}
        />
        <StatCard
          icon={<FunctionSquareIcon className="size-4" />}
          label="Functions"
          value={functions?.length}
          isLoading={functionsLoading}
        />
        <StatCard
          icon={<PackageIcon className="size-4" />}
          label="Extensions"
          value={extensions?.length}
          isLoading={extensionsLoading}
        />
        <StatCard
          icon={<ListOrderedIcon className="size-4" />}
          label="Sequenzen"
          value={sequences?.length}
          isLoading={sequencesLoading}
        />
      </div>
    </div>
  );
}

export function HomeView() {
  const connections = useConnectionsStore((s) => s.connections);
  const setActiveId = useConnectionsStore((s) => s.setActiveId);
  const activeConnection = useActiveConnection();
  const navigate = useNavigate();

  useEffect(() => {
    if (connections.length === 0) {
      void navigate({ to: "/connections" });
    }
  }, [connections.length, navigate]);

  if (activeConnection) {
    return <ConnectedDashboard />;
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <p className="text-sm text-muted-foreground">Wähle eine Verbindung</p>
      <div className="flex flex-col gap-2 w-full max-w-sm">
        {connections.map((conn) => (
          <button
            key={conn.id}
            onClick={() => setActiveId(conn.id)}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50"
          >
            <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 font-medium">{conn.name}</span>
            <span className="text-xs text-muted-foreground uppercase">{conn.kind}</span>
          </button>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/connections" })}>
        Verbindungen verwalten
      </Button>
    </main>
  );
}
