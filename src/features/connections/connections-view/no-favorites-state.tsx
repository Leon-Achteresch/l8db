import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConnectionsNoFavoritesState({
  setFavoritesOnly,
}: {
  setFavoritesOnly: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
      <div className="grid size-10 place-items-center rounded-xl bg-amber-500/10 text-amber-500">
        <Star className="size-5" />
      </div>
      <p className="text-sm font-semibold">Keine Favoriten vorhanden</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Markiere Verbindungen mit dem Stern, um sie direkt griffbereit zu haben.
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => setFavoritesOnly(false)}>
        Alle Verbindungen anzeigen
      </Button>
    </div>
  );
}
