import { ChevronDownIcon, FileJsonIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";
import { useHasNewFeatures } from "@/lib/new-features";
import { snapshotFileLabel } from "@/lib/schema-compare/store";
import type { CompareSide } from "@/lib/schema-compare/types";
import { SchemaCompareSidePicker } from "./schema-compare-side-picker";

interface SchemaCompareSideChipProps {
  title: "Quelle" | "Ziel";
  value: CompareSide;
  other: CompareSide;
  onChange: (value: CompareSide) => void;
}

export function SchemaCompareSideChip({
  title,
  value,
  other,
  onChange,
}: SchemaCompareSideChipProps) {
  const connection = useConnectionsStore(
    (state) => state.connections.find((item) => item.id === value.connectionId) ?? null,
  );
  const snapshotNew = useHasNewFeatures("schema-compare.snapshot");
  const name = value.snapshot
    ? snapshotFileLabel(value.snapshot.path)
    : (connection?.name ?? "Verbindung wählen");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 max-w-72 gap-1.5 px-2 text-xs"
          aria-label={`${title}: ${name}`}
          title={value.snapshot ? `${title}: Snapshot ${value.snapshot.path}` : title}
        >
          {value.snapshot ? (
            <FileJsonIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : connection ? (
            <ProviderLogo
              providerId={providerFor(connection).id}
              kind={connection.kind}
              className="size-3.5 shrink-0"
            />
          ) : (
            <span className="text-muted-foreground">{title}</span>
          )}
          <span className="truncate font-medium">{name}</span>
          {value.schema && (
            <span className="truncate font-mono text-muted-foreground">{value.schema}</span>
          )}
          {snapshotNew && <NewBadge />}
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <SchemaCompareSidePicker title={title} value={value} other={other} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
