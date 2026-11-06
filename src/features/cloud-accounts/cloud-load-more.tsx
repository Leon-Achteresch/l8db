import { Button } from "@/components/ui/button";

export function CloudLoadMore({
  hasMore,
  loading,
  onLoad,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  if (!hasMore) return null;
  return (
    <Button variant="ghost" size="sm" className="self-start" disabled={loading} onClick={onLoad}>
      {loading ? "Lade…" : "Mehr laden"}
    </Button>
  );
}
