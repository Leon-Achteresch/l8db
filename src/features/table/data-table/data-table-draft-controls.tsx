import { Check, Loader2 } from "lucide";
import { CopyPlusIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  isInserting: boolean;
  insertError: string | null;
  onDiscard: () => void;
  onSave: () => void;
};

export function DataTableDraftControls({ isInserting, insertError, onDiscard, onSave }: Props) {
  return (
    <div data-draft-controls className="shrink-0 border-b border-primary/30 bg-primary/5 px-3 py-2">
      <div className="flex items-center gap-3">
        <CopyPlusIcon className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium">Neue Zeile · Entwurf</span>
          <span className="ml-2 text-muted-foreground">
            Werte bearbeiten, dann speichern. Schlüsselwerte prüfen.
          </span>
        </div>
        <Button size="sm" variant="ghost" disabled={isInserting} onClick={onDiscard}>
          Verwerfen
        </Button>
        <Button size="sm" disabled={isInserting} onClick={onSave}>
          <MorphIcon
            icon={isInserting ? Loader2 : Check}
            className={cn("size-3.5", isInserting && "animate-spin")}
          />
          Speichern
        </Button>
      </div>
      {insertError && (
        <p role="alert" className="mt-2 whitespace-pre-wrap text-xs text-destructive">
          {insertError}
        </p>
      )}
    </div>
  );
}
