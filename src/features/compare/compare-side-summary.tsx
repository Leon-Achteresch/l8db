import { LoaderIcon } from "lucide-react";

import { ProviderLogo } from "@/components/provider-logo";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { COMPARE_OBJECT_LABELS, type CompareSideSelection } from "@/lib/compare-types";
import { providerFor } from "@/lib/connection-url";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";

interface CompareSideSummaryProps {
  side: CompareSideSelection;
  loading: boolean;
  error: string | null;
}

function connectionMeta(connection: SavedConnection | null) {
  if (!connection) return null;
  const provider = providerFor(connection);
  return { connection, provider };
}

export function CompareSideSummary({ side, loading, error }: CompareSideSummaryProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const meta = connectionMeta(connections.find((item) => item.id === side.connectionId) ?? null);
  const objectLabel =
    side.schema && side.objectName ? `${side.schema}.${side.objectName}` : "Kein Objekt gewählt";

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {meta ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted ring-1 ring-border">
          <ProviderLogo
            providerId={meta.provider.id}
            kind={meta.connection.kind}
            className="size-4"
          />
        </span>
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted ring-1 ring-border">
          <CompareObjectIcon type={side.objectType} className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-medium">
          <CompareObjectIcon type={side.objectType} />
          <span className="truncate">{objectLabel}</span>
          {loading && <LoaderIcon className="size-3 shrink-0 animate-spin text-muted-foreground" />}
        </div>
        <div className="truncate text-muted-foreground">
          {meta
            ? `${meta.connection.name} · ${side.database ?? "—"} · ${COMPARE_OBJECT_LABELS[side.objectType]}`
            : "Keine Verbindung"}
        </div>
        {error && <div className="truncate text-destructive">{error}</div>}
      </div>
    </div>
  );
}
