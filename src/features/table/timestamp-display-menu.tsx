import { ClockIcon } from "lucide-react";
import { IconMenuSubTrigger } from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useQueryQolSettings } from "@/lib/query-qol-settings";
import type { TimestampOptions } from "@/lib/timestamp-display";

const LABELS = { raw: "Original", utc: "UTC", local: "Lokal" };

export function TimestampDisplayMenu() {
  const options = useQueryQolSettings((s) => s.timestamps);
  const update = useQueryQolSettings((s) => s.setTimestamps);
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.results.timestamps");
  return (
    <DropdownMenuSub>
      <IconMenuSubTrigger icon={<ClockIcon />} label={`Zeitdarstellung: ${LABELS[options.mode]}`}>
        {feature.isNew && <NewBadge className="absolute -right-1 -top-1" />}
      </IconMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-64 whitespace-normal" sideOffset={8}>
          <div ref={feature.ref}>
            <DropdownMenuLabel>Zeitdarstellung</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={options.mode}
              onValueChange={(mode) =>
                update({ ...options, mode: mode as TimestampOptions["mode"] })
              }
            >
              <DropdownMenuRadioItem value="raw">Original</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="utc">UTC</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="local">Lokale Zeitzone</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Genauigkeit</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={options.precision}
              onValueChange={(precision) =>
                update({ ...options, precision: precision as TimestampOptions["precision"] })
              }
            >
              <DropdownMenuRadioItem value="seconds">Sekunden</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="milliseconds">Millisekunden</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
              Nur die Anzeige ändert sich. Kopieren, Bearbeiten und Export behalten die Rohwerte.
              Werte ohne Zeitzone bleiben unverändert.
            </p>
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
