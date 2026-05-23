import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettingsStore } from "@/lib/settings";

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const { rowLimit, editorFontSize, queryTimeout, setRowLimit, setEditorFontSize, setQueryTimeout } =
    useSettingsStore();

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

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Zeilenlimit</p>
            <p className="text-sm text-muted-foreground">
              Maximale Anzahl Zeilen pro Seite (10 – 5000)
            </p>
          </div>
          <Input
            type="number"
            min={10}
            max={5000}
            step={50}
            value={rowLimit}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 10 && v <= 5000) setRowLimit(v);
            }}
            className="w-24 text-right"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Editor-Schriftgröße</p>
            <p className="text-sm text-muted-foreground">
              Schriftgröße im SQL-Editor in Pixeln (10 – 24)
            </p>
          </div>
          <Input
            type="number"
            min={10}
            max={24}
            step={1}
            value={editorFontSize}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 10 && v <= 24) setEditorFontSize(v);
            }}
            className="w-24 text-right"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Query-Timeout</p>
            <p className="text-sm text-muted-foreground">
              Maximale Ausführungszeit für Abfragen in Sekunden (5 – 300)
            </p>
          </div>
          <Input
            type="number"
            min={5}
            max={300}
            step={5}
            value={queryTimeout}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 5 && v <= 300) setQueryTimeout(v);
            }}
            className="w-24 text-right"
          />
        </div>
      </div>
    </main>
  );
}
