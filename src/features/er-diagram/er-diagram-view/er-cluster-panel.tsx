import { Layers3 } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ErClusterPanel({
  clusterCount,
  tableCount,
  foreignKeyCount,
  onOverview,
}: {
  clusterCount: number;
  tableCount: number;
  foreignKeyCount: number;
  onOverview: () => void;
}) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("er-diagram.clusters");
  return (
    <div
      ref={ref}
      className="rounded-md bg-card border border-border px-3 py-2 text-xs text-muted-foreground shadow-sm"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Layers3 className="size-3.5" />
        <span className="font-medium text-foreground">{clusterCount} Cluster</span>
        {isNew && <NewBadge />}
        <button
          type="button"
          onClick={onOverview}
          className="ms-auto rounded border border-border px-2 py-1 text-foreground hover:bg-accent"
        >
          Übersicht
        </button>
      </div>
      <span className="font-medium text-foreground">{tableCount}</span> Tabellen,{" "}
      <span className="font-medium text-foreground">{foreignKeyCount}</span> Foreign Keys
      <p className="mt-1 text-[10px]">Hineinzoomen öffnet Cluster mit PK/FK-Verbindungen.</p>
    </div>
  );
}
