import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveConnection } from "@/lib/connections";
import {
  detectShortcutPlatform,
  filterShortcuts,
  groupShortcutsByArea,
  isShortcutAvailable,
  SHORTCUTS,
  shortcutKeys,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const [term, setTerm] = useState("");
  const connection = useActiveConnection();
  const platform = useMemo(() => detectShortcutPlatform(), []);
  const groups = useMemo(
    () => groupShortcutsByArea(filterShortcuts(SHORTCUTS, term, platform)),
    [platform, term],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tastenkürzel</DialogTitle>
          <DialogDescription>
            Alle in l8db registrierten Tastenkürzel. Nicht verfügbare Aktionen sind ausgegraut.
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
                {group.shortcuts.map((shortcut) => {
                  const available = isShortcutAvailable(shortcut, {
                    hasConnection: connection !== null,
                  });
                  return (
                    <div
                      key={shortcut.id}
                      className={cn(
                        "flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm",
                        available ? "text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {shortcut.label}
                        {!available && (
                          <span className="ml-2 text-xs">(Verbindung erforderlich)</span>
                        )}
                      </span>
                      <KbdGroup>
                        {shortcutKeys(shortcut.binding, platform).map((key) => (
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
      </DialogContent>
    </Dialog>
  );
}
