import { HashIcon } from "lucide-react";
import { IconMenuSubTrigger } from "@/components/icon-menu";
import { ICON_MENU_SUB_BELOW } from "@/components/icon-menu/shared";
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

export function NumberDisplayMenu() {
  const options = useQueryQolSettings((state) => state.numbers);
  const update = useQueryQolSettings((state) => state.setNumbers);
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.results.numbers");
  return (
    <DropdownMenuSub>
      <IconMenuSubTrigger
        icon={<HashIcon />}
        label={`Zahlen: ${options.mode === "raw" ? "Original" : "Gruppiert"}`}
      >
        {feature.isNew && <NewBadge className="absolute -right-1 -top-1" />}
      </IconMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-64 whitespace-normal" {...ICON_MENU_SUB_BELOW}>
          <div ref={feature.ref}>
            <DropdownMenuLabel>Zahlendarstellung</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={options.mode}
              onValueChange={(mode) =>
                update({ ...options, mode: mode === "grouped" ? "grouped" : "raw" })
              }
            >
              <DropdownMenuRadioItem value="raw">Original</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="grouped">Zifferngruppen</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Nachkommastellen (mindestens)</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(options.minimumFractionDigits)}
              onValueChange={(digits) =>
                update({
                  ...options,
                  minimumFractionDigits: digits === "2" ? 2 : digits === "4" ? 4 : 0,
                })
              }
            >
              <DropdownMenuRadioItem value="0" disabled={options.mode === "raw"}>
                Wie im Wert
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="2" disabled={options.mode === "raw"}>
                2
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="4" disabled={options.mode === "raw"}>
                4
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
              Nur Anzeige, ohne Rundung. Alle vorhandenen Nachkommastellen bleiben erhalten.
              Zahlenstrings nur bei bekanntem Zahlentyp; Kopieren, Bearbeiten und Export bleiben
              original.
            </p>
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
