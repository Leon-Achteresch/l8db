import { Plus, Server, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConnectionsEmptyState({
  openEditor,
  setImportOpen,
}: {
  openEditor: (id: string | null) => void;
  setImportOpen: (open: boolean) => void;
}) {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed border-border/80 p-12 text-center shadow-xs">
        <div className="grid size-12 place-items-center rounded-xl bg-muted/80 text-muted-foreground">
          <Server className="size-6" />
        </div>
        <h3 className="text-base font-semibold">Noch keine Verbindung vorhanden</h3>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Erstelle deine erste Datenbankverbindung oder importiere gespeicherte Profile aus anderen
          Tools.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" data-tour="connection-add" onClick={() => openEditor("new")}>
            <Plus className="size-4" />
            Neue Verbindung
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Profile importieren
          </Button>
        </div>
      </div>
    </section>
  );
}
