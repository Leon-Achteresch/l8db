import { ClockIcon } from "lucide-react";
import { useContext } from "react";
import { IconMenuSubTrigger } from "@/components/icon-menu";
import { ICON_MENU_SUB_BELOW } from "@/components/icon-menu/shared";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useHasNewFeatures } from "@/lib/new-features";
import { useQueryQolSettings } from "@/lib/query-qol-settings";
import type { TimestampOptions } from "@/lib/timestamp-display";
import { BusinessTimeZoneContext } from "./business-time-zone-context";
import { NumberDisplayMenu } from "./number-display-menu";

const LABELS = { raw: "Original", utc: "UTC", local: "Lokal", business: "Fachzone" };

export function TimestampDisplayMenu() {
  const options = useQueryQolSettings((s) => s.timestamps);
  const update = useQueryQolSettings((s) => s.setTimestamps);
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.results.timestamps");
  const chooseZone = useContext(BusinessTimeZoneContext);
  const zoneFeature = useNewFeatureVisibility<HTMLDivElement>(
    chooseZone ? "query.results.timestamps.business-zone" : undefined,
  );
  const zoneNew = useHasNewFeatures("query.results.timestamps.business-zone") && chooseZone;
  const mode = options.mode === "business" && !chooseZone ? "raw" : options.mode;
  return (
    <>
      <DropdownMenuSub>
        <IconMenuSubTrigger icon={<ClockIcon />} label={`Zeitdarstellung: ${LABELS[mode]}`}>
          {(feature.isNew || zoneNew) && <NewBadge className="absolute -right-1 -top-1" />}
        </IconMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="w-64 whitespace-normal" {...ICON_MENU_SUB_BELOW}>
            <div ref={feature.ref}>
              <DropdownMenuLabel>Zeitdarstellung</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={(mode) =>
                  update({ ...options, mode: mode as TimestampOptions["mode"] })
                }
              >
                <DropdownMenuRadioItem value="raw">Original</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="utc">UTC</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="local">Lokale Zeitzone</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {chooseZone ? (
                <DropdownMenuItem
                  onSelect={chooseZone}
                  ref={zoneFeature.ref}
                  className="justify-between"
                >
                  <span className="min-w-0 truncate">
                    {mode === "business" ? `Fachzone · ${options.timeZone}` : "Fachliche Zeitzone…"}
                  </span>
                  {zoneFeature.isNew ? (
                    <span aria-hidden>
                      <NewBadge />
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Genauigkeit</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={options.precision}
                onValueChange={(precision) =>
                  update({ ...options, precision: precision as TimestampOptions["precision"] })
                }
              >
                <DropdownMenuRadioItem value="seconds" disabled={mode === "business"}>
                  Sekunden
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="milliseconds" disabled={mode === "business"}>
                  Millisekunden
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
                Nur die Anzeige ändert sich. Kopieren, Bearbeiten und Export behalten die Rohwerte.
                Werte ohne Zeitzone bleiben unverändert.
                {mode === "business" && " Die Fachzone zeigt die vorhandenen Nachkommastellen."}
              </p>
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
      <NumberDisplayMenu />
    </>
  );
}
