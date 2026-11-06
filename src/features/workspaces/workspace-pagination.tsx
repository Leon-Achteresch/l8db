import { Button } from "@/components/ui/button";

export function WorkspacePagination({
  offset,
  more,
  disabled = false,
  onChange,
}: {
  offset: number;
  more: boolean;
  disabled?: boolean;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-3 text-xs text-muted-foreground">
      <span>Seite {Math.floor(offset / 100) + 1}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || offset === 0}
        onClick={() => onChange(Math.max(0, offset - 100))}
      >
        Zurück
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !more}
        onClick={() => onChange(offset + 100)}
      >
        Weiter
      </Button>
    </div>
  );
}
