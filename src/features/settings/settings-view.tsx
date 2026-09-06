import { useTheme } from "next-themes";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CommunityExtensionsSection } from "@/features/community-extensions/community-extensions-section";
import { SettingsRow } from "@/features/settings/settings-row";
import { UpdateSection } from "@/features/settings/update-section";
import { useSettingsStore } from "@/lib/settings";

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const {
    rowLimit,
    editorFontSize,
    queryTimeout,
    sshTrustNewHosts,
    transactionsEnabled,
    setRowLimit,
    setEditorFontSize,
    setQueryTimeout,
    setSshTrustNewHosts,
    setTransactionsEnabled,
  } = useSettingsStore();

  return (
    <main className="workspace-canvas h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>
        <div className="mt-6 space-y-3">
          <SettingsRow title="Erscheinungsbild" description="Hell, dunkel oder dem System folgen.">
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
          <SettingsRow title="Zeilenlimit" description="Maximale Zeilen pro Seite, 10 bis 5000.">
            <Input
              type="number"
              min={10}
              max={5000}
              step={50}
              aria-label="Zeilenlimit"
              value={rowLimit}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value) && value >= 10 && value <= 5000) setRowLimit(value);
              }}
              className="h-9 w-[4.5rem] text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </SettingsRow>
          <SettingsRow
            title="Editor-Schriftgröße"
            description="Schriftgröße im Abfrage-Editor, 10 bis 24 Pixel."
          >
            <Input
              type="number"
              min={10}
              max={24}
              step={1}
              aria-label="Editor-Schriftgröße"
              value={editorFontSize}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value) && value >= 10 && value <= 24) setEditorFontSize(value);
              }}
              className="h-9 w-[4.5rem] text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </SettingsRow>
          <SettingsRow
            title="Query-Timeout"
            description="Maximale Ausführungszeit, 5 bis 300 Sekunden."
          >
            <Input
              type="number"
              min={5}
              max={300}
              step={5}
              aria-label="Query-Timeout"
              value={queryTimeout}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value) && value >= 5 && value <= 300) setQueryTimeout(value);
              }}
              className="h-9 w-[4.5rem] text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </SettingsRow>
          <SettingsRow
            title="Neue SSH-Host-Keys akzeptieren"
            description="Unbekannte Server-Keys beim ersten Verbinden speichern."
          >
            <Switch
              checked={sshTrustNewHosts}
              onCheckedChange={setSshTrustNewHosts}
              aria-label="Neue SSH-Host-Keys akzeptieren"
            />
          </SettingsRow>
          <SettingsRow
            title="Änderungen als Transaktion"
            description="Zeilenänderungen und DML-Abfragen sammeln und erst nach Commit schreiben. Deaktiviert wird jede Änderung sofort gespeichert."
          >
            <Switch
              checked={transactionsEnabled}
              onCheckedChange={setTransactionsEnabled}
              aria-label="Änderungen als Transaktion"
            />
          </SettingsRow>
          <UpdateSection />
          <CommunityExtensionsSection />
        </div>
      </div>
    </main>
  );
}
