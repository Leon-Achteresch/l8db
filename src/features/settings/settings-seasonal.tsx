import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { endSpiderVisit } from "@/lib/seasonal";
import { useSettingsStore } from "@/lib/settings";

const SeasonalPreview = lazy(() =>
  import("@/features/settings/seasonal-preview").then(({ SeasonalPreview }) => ({
    default: SeasonalPreview,
  })),
);

export function SettingsSeasonal() {
  const enabled = useSettingsStore((state) => state.seasonalAccents);
  const setEnabled = useSettingsStore((state) => state.setSeasonalAccents);
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsRow settingId="seasonal-accents" featureId="settings.appearance.seasonal">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls="seasonal-preview"
            disabled={!enabled}
            onClick={() => {
              if (open) endSpiderVisit();
              setOpen(!open);
            }}
          >
            {open ? "Vorschau schließen" : "Feiertage ansehen"}
          </Button>
          <Switch
            aria-label="Saisonale Akzente"
            checked={enabled}
            onCheckedChange={(value) => {
              setEnabled(value);
              if (!value) setOpen(false);
            }}
          />
        </div>
      </SettingsRow>
      {open && enabled ? (
        <SettingsRow
          title="Kleine Gäste, große Feiertagslaune"
          description="19 kleine Persönlichkeiten. Such dir einen Feiertag aus und lass seinen Gast vorbeischauen – auch mitten im Sommer."
          featureId="settings.appearance.seasonal.calendar"
          stacked
        >
          <div id="seasonal-preview" className="w-full">
            <Suspense
              fallback={
                <p className="py-8 text-xs text-muted-foreground">
                  Die Feiertagsgäste machen sich bereit …
                </p>
              }
            >
              <SeasonalPreview />
            </Suspense>
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}
