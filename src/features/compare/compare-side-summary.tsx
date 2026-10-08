import { LoaderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import type { CompareSideSelection } from "@/lib/compare-types";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";

interface CompareSideSummaryProps {
  label: string;
  side: CompareSideSelection;
  loading: boolean;
  error: string | null;
  children?: ReactNode;
}

export function CompareSideSummary({
  label,
  side,
  loading,
  error,
  children,
}: CompareSideSummaryProps) {
  const connection = useConnectionsStore(
    (state) => state.connections.find((item) => item.id === side.connectionId) ?? null,
  );
  const object = side.schema && side.objectName ? `${side.schema}.${side.objectName}` : null;

  return (
    <div className="flex h-8 min-w-0 items-center gap-2 px-3 text-xs">
      {connection ? (
        <ProviderLogo
          providerId={providerFor(connection).id}
          kind={connection.kind}
          className="size-3.5 shrink-0"
        />
      ) : (
        <CompareObjectIcon
          type={side.objectType}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="shrink-0 truncate font-medium">
        {connection?.name ?? "Keine Verbindung"}
      </span>
      {side.database && (
        <span className="hidden shrink truncate text-muted-foreground xl:inline">
          {side.database}
        </span>
      )}
      <span className="min-w-0 truncate font-mono text-muted-foreground">
        {object ?? "Kein Objekt gewählt"}
      </span>
      {loading && <LoaderIcon className="size-3 shrink-0 animate-spin text-muted-foreground" />}
      {error && (
        <span className="min-w-0 truncate text-destructive" title={error}>
          {error}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center">{children}</span>
    </div>
  );
}
