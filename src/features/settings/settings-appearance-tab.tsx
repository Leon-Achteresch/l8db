import { useTheme } from "next-themes";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { SettingsAppearance } from "@/features/settings/settings-appearance";
import { SettingsRow } from "@/features/settings/settings-row";

export function SettingsAppearanceTab() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="@container space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Darstellung</h2>
        <p className="text-xs text-muted-foreground">
          Erscheinungsbild, Oberflächengröße und Abstände anpassen.
        </p>
      </div>
      <div className="space-y-3">
        <SettingsRow settingId="theme">
          <SegmentedControl
            value={(theme ?? "system") as "light" | "system" | "dark"}
            onChange={setTheme}
            label="Erscheinungsbild"
            options={[
              { value: "light", label: "Hell" },
              { value: "system", label: "System" },
              { value: "dark", label: "Dunkel" },
            ]}
          />
        </SettingsRow>
        <SettingsAppearance />
      </div>
    </div>
  );
}
