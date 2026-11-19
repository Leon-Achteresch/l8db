import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function UnloggedTableBadge() {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("table.structure.unlogged");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={feature.ref}
          type="button"
          size="xs"
          variant="secondary"
          className="relative mx-1 shrink-0 font-mono text-2xs"
        >
          UNLOGGED
          {feature.isNew ? (
            <span aria-hidden>
              <NewBadge className="absolute -right-2 -top-1.5" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Persistenz der Tabelle"
        align="end"
        className="w-[min(19rem,calc(100vw-2rem))] gap-1.5 p-3"
      >
        <h2 className="font-medium">UNLOGGED</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          PostgreSQL schreibt Datenänderungen dieser Tabelle nicht ins Write-Ahead Log. Bei der
          Wiederherstellung nach einem Absturz wird sie geleert. Ihre Daten werden nicht auf
          Standby-Server repliziert.
        </p>
      </PopoverContent>
    </Popover>
  );
}
