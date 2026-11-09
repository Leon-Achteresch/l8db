import { HotkeyKbd } from "@/components/hotkey-kbd";

const SHORTCUTS = [
  ["palette.open", "Suchen und Befehle"],
  ["palette.quickOpen", "Schnell öffnen"],
  ["tab.newQuery", "Neue Abfrage"],
  ["sidebar.toggle", "Seitenleiste ein- / ausblenden"],
  ["ai.toggle", "KI-Assistent ein- / ausblenden"],
  ["settings.open", "Einstellungen"],
] as const;

export function WelcomeShortcuts() {
  return (
    <section aria-labelledby="welcome-shortcuts">
      <h2 id="welcome-shortcuts" className="mb-3 text-sm font-semibold">
        Tastenkürzel
      </h2>
      <dl>
        {SHORTCUTS.map(([id, label]) => (
          <div key={id} className="flex min-h-8 items-center justify-between gap-3 py-1">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="shrink-0">
              <HotkeyKbd command={id} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
