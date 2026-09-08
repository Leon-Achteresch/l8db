import { HOTKEY_COMMANDS, type HotkeyArea as NewHotkeyArea, resolveHotkey } from "@/lib/hotkeys";

export type ShortcutPlatform = "mac" | "other";

export type ShortcutArea = "Allgemein" | "Tabs" | "Navigation" | "SQL-Editor" | "Datengitter";

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

function parseDefaultHotkey(hotkey: string): ShortcutBinding {
  const parts = hotkey.split("+").map((part) => part.trim());
  const key = parts[parts.length - 1] ?? "";
  const binding: ShortcutBinding = { key };
  for (const part of parts.slice(0, -1)) {
    const token = part.toLowerCase();
    if (token === "mod" || token === "cmd" || token === "command" || token === "meta") {
      binding.mod = true;
    } else if (token === "ctrl" || token === "control") {
      binding.mod = true;
    } else if (token === "shift") {
      binding.shift = true;
    } else if (token === "alt" || token === "option") {
      binding.alt = true;
    }
  }
  return binding;
}

function toShortcutArea(area: NewHotkeyArea): ShortcutArea {
  return area;
}

export const SHORTCUTS: ShortcutDefinition[] = HOTKEY_COMMANDS.map((command) => ({
  id: command.id,
  label: command.label,
  area: toShortcutArea(command.area),
  binding: parseDefaultHotkey(resolveHotkey(command.id)),
  ...(command.requiresConnection ? { requires: "connection" as const } : {}),
}));

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
