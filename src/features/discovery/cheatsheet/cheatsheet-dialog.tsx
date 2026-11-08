import { useRouterState } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useActiveCapabilities } from "@/lib/db-selection";
import { cheatsheetCommands, featuresForRoute } from "@/lib/discovery/cheatsheet/cheatsheet";
import { highlightFeature } from "@/lib/discovery/highlight";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { splitHotkeyForKbd } from "@/lib/hotkeys/display";
import { resolveHotkey, useHotkeysStore } from "@/lib/hotkeys/use-hotkeys-store";
import { useSettingsStore } from "@/lib/settings";

export function CheatsheetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const easyMode = useSettingsStore((state) => state.easyMode);
  const capabilities = useActiveCapabilities();
  const overrides = useHotkeysStore((state) => state.overrides);
  const [term, setTerm] = useState("");
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("discover.cheatsheet");

  const groups = useMemo(() => {
    void overrides;
    return cheatsheetCommands(pathname, term, easyMode);
  }, [pathname, term, easyMode, overrides]);
  const features = useMemo(
    () => featuresForRoute(pathname, term, { capabilities, easyMode }).slice(0, 40),
    [pathname, term, capabilities, easyMode],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTerm("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl gap-4" aria-describedby={undefined}>
        <DialogTitle ref={feature.ref} className="flex items-center gap-2">
          Spickzettel
          {feature.isNew && <NewBadge />}
        </DialogTitle>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Suchen…"
            className="pl-8"
            aria-label="Spickzettel durchsuchen"
          />
        </div>
        <div className="grid max-h-[60vh] gap-6 overflow-y-auto sm:grid-cols-2">
          <section aria-label="Kürzel hier" className="flex min-w-0 flex-col gap-3">
            <h3 className="px-1 text-xs font-medium text-muted-foreground">Kürzel hier</h3>
            {groups.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">Keine Treffer</p>
            )}
            {groups.map((group) => (
              <div key={group.area} className="flex flex-col gap-0.5">
                <span className="px-1 text-[11px] text-muted-foreground/80">{group.area}</span>
                {group.commands.map((command) => (
                  <div
                    key={command.id}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md px-1 py-1 text-sm"
                  >
                    <span className="min-w-0 truncate">{command.label}</span>
                    <KbdGroup className="shrink-0">
                      {splitHotkeyForKbd(resolveHotkey(command.id, overrides)).map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  </div>
                ))}
              </div>
            ))}
          </section>
          <section aria-label="Funktionen hier" className="flex min-w-0 flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-muted-foreground">Funktionen hier</h3>
            {features.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">Keine Treffer</p>
            )}
            {features.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  void highlightFeature(entry.id);
                }}
                className="flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none active:bg-muted"
              >
                <span className="text-sm">{entry.title}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{entry.summary}</span>
              </button>
            ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
