import { AlertTriangleIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HotkeyRecorderInput } from "@/components/ui/hotkey-recorder-input";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { cn } from "@/lib/utils";

export function SettingsHotkeysTab() {
  const [term, setTerm] = useState("");
  const overrides = useHotkeysStore((state) => state.overrides);
  const setOverride = useHotkeysStore((state) => state.setOverride);
  const resetAll = useHotkeysStore((state) => state.resetAll);
  const connection = useActiveConnection();

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
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Tastenkürzel</h2>
        <p className="text-xs text-muted-foreground">
          Alle Befehle frei belegbar, inklusive Kombinationen mit Strg, Umschalt und Alt sowie
          Funktionstasten. Klick auf ein Kürzel, neue Tasten drücken, fertig.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Befehl oder Tastenkürzel suchen…"
            className="pl-8"
            aria-label="Tastenkürzel durchsuchen"
          />
        </div>
        <Button
          type="button"
          variant="outline"
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
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
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

      <ScrollArea className="max-h-[58vh] w-full overflow-x-clip">
        <div className="flex flex-col gap-5 pr-4">
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Keine Treffer</p>
          )}
          {groups.map((group) => (
            <section key={group.area} className="flex flex-col gap-2">
              <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
                    className={cn(
                      "flex min-w-0 items-center justify-between gap-4 overflow-x-clip rounded-xl border border-border/60 bg-card px-3 py-2",
                      !available && "opacity-60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {command.label}
                        {!available && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            (Verbindung erforderlich)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {command.description}
                        {command.reference ? ` · ${command.reference}` : ""}
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
