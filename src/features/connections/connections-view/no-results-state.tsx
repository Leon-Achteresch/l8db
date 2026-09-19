import { Search } from "lucide-react";
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
      <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Search className="size-5" />
      </div>
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
