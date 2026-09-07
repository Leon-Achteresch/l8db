export type ShortcutPlatform = "mac" | "other";

export type ShortcutArea = "Allgemein" | "Navigation" | "SQL-Editor" | "Datengitter";

export type ShortcutRequirement = "connection";

export interface ShortcutBinding {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

export interface ShortcutDefinition {
  id: string;
  label: string;
  area: ShortcutArea;
  binding: ShortcutBinding;
  requires?: ShortcutRequirement;
}

export interface ShortcutAvailabilityContext {
  hasConnection: boolean;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "palette.open",
    label: "Suche und Befehlspalette öffnen",
    area: "Navigation",
    binding: { mod: true, key: "K" },
  },
  {
    id: "sidebar.toggle",
    label: "Seitenleiste ein- oder ausblenden",
    area: "Navigation",
    binding: { mod: true, key: "B" },
  },
  {
    id: "shortcuts.open",
    label: "Tastenkürzelhilfe öffnen",
    area: "Allgemein",
    binding: { mod: true, key: "/" },
  },
  {
    id: "dialog.close",
    label: "Dialog oder Overlay schließen",
    area: "Allgemein",
    binding: { key: "Esc" },
  },
  {
    id: "settings.search",
    label: "Einstellungen durchsuchen",
    area: "Allgemein",
    binding: { mod: true, key: "F" },
  },
  {
    id: "query.run",
    label: "Abfrage ausführen",
    area: "SQL-Editor",
    binding: { mod: true, key: "Enter" },
    requires: "connection",
  },
  {
    id: "query.runSelection",
    label: "Markierung ausführen",
    area: "SQL-Editor",
    binding: { mod: true, shift: true, key: "Enter" },
    requires: "connection",
  },
  {
    id: "query.runStatement",
    label: "Anweisung unter dem Cursor ausführen",
    area: "SQL-Editor",
    binding: { mod: true, alt: true, key: "Enter" },
    requires: "connection",
  },
  {
    id: "query.save",
    label: "Abfrage speichern",
    area: "SQL-Editor",
    binding: { mod: true, key: "S" },
  },
  {
    id: "query.format",
    label: "SQL formatieren",
    area: "SQL-Editor",
    binding: { shift: true, alt: true, key: "F" },
  },
  {
    id: "grid.search",
    label: "In Ergebnissen suchen",
    area: "Datengitter",
    binding: { mod: true, key: "F" },
    requires: "connection",
  },
  {
    id: "grid.copy",
    label: "Auswahl kopieren",
    area: "Datengitter",
    binding: { mod: true, key: "C" },
    requires: "connection",
  },
];

export function detectShortcutPlatform(platform?: string): ShortcutPlatform {
  const value = platform ?? (typeof navigator === "undefined" ? "" : (navigator.platform ?? ""));
  return /Mac|iPhone|iPad|iPod/i.test(value) ? "mac" : "other";
}

export function shortcutKeys(binding: ShortcutBinding, platform: ShortcutPlatform): string[] {
  const keys: string[] = [];
  if (binding.mod) keys.push(platform === "mac" ? "Cmd" : "Ctrl");
  if (binding.shift) keys.push("Shift");
  if (binding.alt) keys.push(platform === "mac" ? "Option" : "Alt");
  keys.push(binding.key);
  return keys;
}

export function formatShortcut(binding: ShortcutBinding, platform: ShortcutPlatform): string {
  return shortcutKeys(binding, platform).join("+");
}

export function isShortcutAvailable(
  shortcut: ShortcutDefinition,
  context: ShortcutAvailabilityContext,
): boolean {
  if (shortcut.requires === "connection") return context.hasConnection;
  return true;
}

export function filterShortcuts(
  shortcuts: ShortcutDefinition[],
  query: string,
  platform: ShortcutPlatform,
): ShortcutDefinition[] {
  const term = query.trim().toLowerCase();
  if (!term) return shortcuts;
  const terms = term.split(/\s+/);
  return shortcuts.filter((shortcut) => {
    const haystack = [
      shortcut.label,
      shortcut.area,
      formatShortcut(shortcut.binding, platform),
      shortcutKeys(shortcut.binding, platform).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((part) => haystack.includes(part));
  });
}

export function groupShortcutsByArea(
  shortcuts: ShortcutDefinition[],
): { area: ShortcutArea; shortcuts: ShortcutDefinition[] }[] {
  const groups: { area: ShortcutArea; shortcuts: ShortcutDefinition[] }[] = [];
  for (const shortcut of shortcuts) {
    const existing = groups.find((group) => group.area === shortcut.area);
    if (existing) existing.shortcuts.push(shortcut);
    else groups.push({ area: shortcut.area, shortcuts: [shortcut] });
  }
  return groups;
}
