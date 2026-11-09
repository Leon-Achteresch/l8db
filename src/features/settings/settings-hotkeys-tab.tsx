import { AlertTriangleIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HotkeyRecorderInput } from "@/components/ui/hotkey-recorder-input";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useActiveConnection } from "@/lib/connections";
import {
  commandById,
  detectHotkeyConflicts,
  filterHotkeyCommands,
  findHotkeyConflict,
  groupHotkeyCommands,
  isHotkeyAvailable,
  resolveHotkey,
  useHotkeysStore,
  validateHotkeyInput,
} from "@/lib/hotkeys";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function SettingsHotkeysTab() {
  const [term, setTerm] = useState("");
  const overrides = useHotkeysStore((state) => state.overrides);
  const setOverride = useHotkeysStore((state) => state.setOverride);
  const resetAll = useHotkeysStore((state) => state.resetAll);
  const connection = useActiveConnection();
  const shortcutHints = useSettingsStore((state) => state.shortcutHints);
  const setShortcutHints = useSettingsStore((state) => state.setShortcutHints);

  const commands = useMemo(() => filterHotkeyCommands(term), [term]);
  const groups = useMemo(() => groupHotkeyCommands(commands), [commands]);
  const conflicts = useMemo(() => detectHotkeyConflicts(overrides), [overrides]);
  const customizedCount = Object.keys(overrides).length;

  const handleRecord = (id: string, hotkey: string) => {
    const validation = validateHotkeyInput(hotkey);
    if (!validation.valid) {
      toast.error(`Ungültig: ${validation.errors.join(", ")}`);
      return;
    }
    const hits = findHotkeyConflict(hotkey, id, overrides);
    const command = commandById(id);
    if (command && (overrides[id] ?? command.defaultHotkey) === hotkey) return;
    setOverride(id, hotkey);
    if (hits.length > 0) {
      const names = hits.map((hit) => commandById(hit)?.label ?? hit).join(", ");
      toast.warning(`Belegt: kollidiert mit ${names}`);
    } else {
      toast.success("Tastenkürzel gespeichert");
    }
  };

  return (
    <div data-setting-id="hotkeys" tabIndex={-1} className="space-y-4">
      <h2 className="text-base font-semibold tracking-tight">Tastenkürzel</h2>

      <SettingsRow settingId="shortcut-hints" featureId="settings.hotkeys.shortcut-hints">
        <Switch
          aria-label="Tastenkürzel-Tipps"
          checked={shortcutHints}
          onCheckedChange={setShortcutHints}
        />
      </SettingsRow>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Befehl oder Tastenkürzel suchen…"
            className="h-8 border-transparent bg-muted/50 pl-8 shadow-none"
            aria-label="Tastenkürzel durchsuchen"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={customizedCount === 0}
          onClick={() => {
            resetAll();
            toast.success("Alle Kürzel zurückgesetzt");
          }}
        >
          <RotateCcwIcon className="size-3.5" />
          Alle zurücksetzen
          {customizedCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {customizedCount}
            </Badge>
          )}
        </Button>
      </div>

      {conflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            {conflicts.length} {conflicts.length === 1 ? "Doppelbelegung" : "Doppelbelegungen"}:{" "}
            {conflicts
              .slice(0, 3)
              .map((conflict) => conflict.ids.join(" ↔ "))
              .join("; ")}
            {conflicts.length > 3 && " …"}
          </p>
        </div>
      )}

      <ScrollArea className="max-h-[58vh] w-full overflow-x-clip [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-5 pr-4">
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Keine Treffer</p>
          )}
          {groups.map((group) => (
            <section key={group.area} className="flex flex-col gap-0.5">
              <h3 className="px-3 pb-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                {group.area}
              </h3>
              {group.commands.map((command) => {
                const current = resolveHotkey(command.id, overrides);
                const isDefault = !(command.id in overrides);
                const available = isHotkeyAvailable(command.id, {
                  hasConnection: connection !== null,
                });
                const conflict = findHotkeyConflict(current, command.id, overrides);
                return (
                  <div
                    key={command.id}
                    title={[command.description, command.reference].filter(Boolean).join(" · ")}
                    className={cn(
                      "flex min-h-9 min-w-0 items-center justify-between gap-4 overflow-x-clip rounded-lg px-3 py-1 transition-colors hover:bg-muted/40",
                      !available && "opacity-60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {command.label}
                        {!available && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Verbindung erforderlich
                          </span>
                        )}
                      </p>
                      {conflict.length > 0 && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangleIcon className="size-3" />
                          Kollidiert mit{" "}
                          {conflict.map((hit) => commandById(hit)?.label ?? hit).join(", ")}
                        </p>
                      )}
                    </div>
                    <HotkeyRecorderInput
                      value={current}
                      isDefault={isDefault}
                      ariaLabel={`${command.label} aufnehmen`}
                      onRecord={(hotkey) => handleRecord(command.id, hotkey)}
                      onClear={() => setOverride(command.id, null)}
                    />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
