import { useActiveSchema } from "@/lib/db-selection";
import { useDatabaseOverviewQuery } from "@/lib/queries";
import { StorageOverview } from "../connected-dashboard/storage-overview";

const MIN_OVERVIEW_SIZE_BYTES = 1024;

export function StorageWidget({ connectionId }: { connectionId: string }) {
  const schema = useActiveSchema();
  const overview = useDatabaseOverviewQuery();
  const hasData =
    overview.isPending ||
    overview.isError ||
    (overview.data?.size_bytes ?? 0) >= MIN_OVERVIEW_SIZE_BYTES ||
    overview.data?.schemas.some((entry) => entry.size_bytes >= MIN_OVERVIEW_SIZE_BYTES);
  if (!hasData)
    return (
      <section className="grid h-full place-items-center rounded-2xl border border-dashed p-5 text-center text-xs text-muted-foreground">
        Für diese Datenbank liegen keine Speicherdaten vor.
      </section>
    );
  return (
    <StorageOverview
      overview={overview}
      schema={schema}
      connectionId={connectionId}
      largestSchema={Math.max(
        1,
        ...(overview.data?.schemas.map((entry) => entry.size_bytes) ?? []),
      )}
    />
  );
}
