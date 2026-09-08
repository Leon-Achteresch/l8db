import { useNavigate } from "@tanstack/react-router";
import { SearchIcon, Settings2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveConnection } from "@/lib/connections";
import {
  filterHotkeyCommands,
  groupHotkeyCommands,
  isHotkeyAvailable,
  resolveHotkey,
  splitHotkeyForKbd,
  useHotkeysStore,
} from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const [term, setTerm] = useState("");
  const connection = useActiveConnection();
  const navigate = useNavigate();
  const overrides = useHotkeysStore((state) => state.overrides);

  const groups = useMemo(() => groupHotkeyCommands(filterHotkeyCommands(term)), [term]);
  void overrides;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tastenkürzel</DialogTitle>
          <DialogDescription>
            Alle registrierten Befehle mit aktueller Belegung. Nicht verfügbare Aktionen sind
            ausgegraut.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Befehl oder Tastenkürzel suchen…"
            className="pl-8"
            aria-label="Tastenkürzel durchsuchen"
          />
        </div>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="flex flex-col gap-4">
            {groups.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Keine Treffer</p>
            )}
            {groups.map((group) => (
              <section key={group.area} className="flex flex-col gap-1">
                <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.area}
                </h3>
                {group.commands.map((command) => {
                  const available = isHotkeyAvailable(command.id, {
                    hasConnection: connection !== null,
                  });
                  const current = resolveHotkey(command.id);
                  const customized = command.id in overrides;
                  return (
                    <div
                      key={command.id}
                      className={cn(
                        "flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm",
                        available ? "text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {command.label}
                        {customized && (
                          <span className="ml-2 text-xs text-primary">(angepasst)</span>
                        )}
                        {!available && (
                          <span className="ml-2 text-xs">(Verbindung erforderlich)</span>
                        )}
                      </span>
                      <KbdGroup>
                        {splitHotkeyForKbd(current).map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </KbdGroup>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              void navigate({ to: "/settings", search: { tab: "hotkeys" } });
            }}
          >
            <Settings2Icon className="size-4" />
            Kürzel anpassen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
