import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Einstellungen</h1>

      <div className="mt-8 space-y-6">
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Erscheinungsbild</p>
            <p className="text-sm text-muted-foreground">
              Wähle ein Theme für die Anwendung
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(val) => {
              if (val) setTheme(val);
            }}
            variant="outline"
            spacing={0}
          >
            <ToggleGroupItem value="light" aria-label="Hell">
              <Sun className="size-4" />
              <span>Hell</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="system" aria-label="System">
              <Monitor className="size-4" />
              <span>System</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dunkel">
              <Moon className="size-4" />
              <span>Dunkel</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </main>
  );
}
