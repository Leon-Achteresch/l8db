import { ListEndIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { ROW_COUNT_CAP } from "@/lib/queries";

interface ResultRowLimitChipProps {
  limit: number;
  disabled: boolean;
  exceedsWarnLimit?: () => Promise<boolean>;
  onRunUnlimited?: () => Promise<void>;
}

export function ResultRowLimitChip({
  limit,
  disabled,
  exceedsWarnLimit,
  onRunUnlimited,
}: ResultRowLimitChipProps) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLButtonElement>("query.results.row-limit");
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [warned, setWarned] = useState(false);
  const label = limit.toLocaleString("de-DE");

  const run = async () => {
    if (!onRunUnlimited) return;
    if (!warned && exceedsWarnLimit) {
      setChecking(true);
      const exceeds = await exceedsWarnLimit().finally(() => setChecking(false));
      if (exceeds) {
        setWarned(true);
        return;
      }
    }
    setOpen(false);
    await onRunUnlimited();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setWarned(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          size="xs"
          variant="ghost"
          className="relative shrink-0 bg-amber-500/10 font-mono tabular-nums text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
          title={`Auf ${label} Zeilen begrenzt`}
          aria-label={`Auf ${label} Zeilen begrenzt`}
        >
          <ListEndIcon aria-hidden />
          {label}+{isNew && <NewBadge className="absolute -right-1 -top-1" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 gap-2 p-3 text-xs">
        <p className="font-medium">Auf {label} Zeilen begrenzt</p>
        {warned && (
          <p className="text-amber-700 dark:text-amber-400">
            Mehr als {ROW_COUNT_CAP.toLocaleString("de-DE")} Zeilen
          </p>
        )}
        <Button
          size="sm"
          variant={warned ? "destructive" : "default"}
          disabled={disabled || checking || !onRunUnlimited}
          onClick={() => void run()}
        >
          {checking && <LoaderIcon className="size-3.5 animate-spin" />}
          {warned ? "Trotzdem ausführen" : "Ohne Limit ausführen"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
