import { Kbd } from "@/components/ui/kbd";
import { formatHotkeyDisplay, useAllResolvedHotkeys } from "@/lib/hotkeys";

const SHORTCUTS = [
  ["palette.open", "Suchen und Befehle"],
  ["palette.quickOpen", "Schnell öffnen"],
  ["tab.newQuery", "Neue Abfrage"],
  ["sidebar.toggle", "Seitenleiste ein- / ausblenden"],
  ["ai.toggle", "KI-Assistent ein- / ausblenden"],
  ["settings.open", "Einstellungen"],
] as const;

export function WelcomeShortcuts() {
  const hotkeys = useAllResolvedHotkeys();
  return (
    <section aria-labelledby="welcome-shortcuts">
      <h2 id="welcome-shortcuts" className="mb-3 text-sm font-semibold">
        Tastenkürzel
      </h2>
      <dl className="divide-y divide-border/60">
        {SHORTCUTS.map(([id, label]) => (
          <div key={id} className="flex min-h-10 items-center justify-between gap-3 py-2">
            <dt className="text-xs leading-relaxed text-muted-foreground">{label}</dt>
            <dd className="shrink-0">
              <Kbd className="rounded-md border border-border/60 bg-muted/40 px-1.5 text-[11px]">
                {formatHotkeyDisplay(hotkeys[id])}
              </Kbd>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
