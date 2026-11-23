import { Illustration } from "@/components/illustration";
import { Button } from "@/components/ui/button";

export function ConnectionsNoResultsState({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (value: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
      <Illustration name="search" className="w-40" />
      <p className="text-sm font-semibold">Keine Treffer</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Es wurde keine Verbindung für „{query.trim()}“ gefunden.
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => setQuery("")}>
        Suche zurücksetzen
      </Button>
    </div>
  );
}
