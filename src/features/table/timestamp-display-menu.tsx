import { ClockIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useQueryQolSettings } from "@/lib/query-qol-settings";
import type { TimestampOptions } from "@/lib/timestamp-display";

const LABELS = { raw: "Original", utc: "UTC", local: "Lokal" };

export function TimestampDisplayMenu() {
  const options = useQueryQolSettings((s) => s.timestamps);
  const update = useQueryQolSettings((s) => s.setTimestamps);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.results.timestamps");
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={feature.ref}
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          title="Zeitdarstellung ändern; Kopieren und Export behalten die Rohwerte"
        >
          <ClockIcon className="size-3.5" />
          Zeit: {LABELS[options.mode]}
          {feature.isNew && <NewBadge />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Zeitdarstellung</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={options.mode}
          onValueChange={(mode) => update({ ...options, mode: mode as TimestampOptions["mode"] })}
        >
          {Object.entries(LABELS).map(([mode, label]) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={options.precision}
          onValueChange={(precision) =>
            update({ ...options, precision: precision as TimestampOptions["precision"] })
          }
        >
          <DropdownMenuRadioItem value="seconds">Sekunden</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="milliseconds">Millisekunden</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">
          Werte ohne Zeitzone bleiben unverändert. Kopieren, Bearbeiten und Export verwenden die
          Rohwerte.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
