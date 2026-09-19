import { type Hotkey, validateHotkey } from "@tanstack/react-hotkeys";
import { HOTKEY_COMMANDS } from "./commands";
import { useHotkeysStore } from "./use-hotkeys-store";

export function canonicalizeHotkey(value: string): string {
  return value
    .split("+")
    .map((part) => {
      const token = part.trim().toLowerCase();
      if (token === "mod" || token === "cmd" || token === "command" || token === "meta")
        return "mod";
      if (token === "ctrl" || token === "control") return "ctrl";
      if (token === "option") return "alt";
      if (token === "esc") return "escape";
      if (token === "spacebar" || token === "space bar") return "space";
      if (token === "left" || token === "arrowleft") return "arrowleft";
      if (token === "right" || token === "arrowright") return "arrowright";
      if (token === "up" || token === "arrowup") return "arrowup";
      if (token === "down" || token === "arrowdown") return "arrowdown";
      if (token === "del") return "delete";
      if (token === "pos1") return "home";
      return token;
    })
    .sort()
    .join("+");
}

export interface HotkeyConflict {
  hotkey: string;
  ids: string[];
}

const ALLOWED_OVERLAPS: string[][] = [["app.refresh", "query.run"]];

function isAllowedOverlap(ids: string[]): boolean {
  const primary = [...new Set(ids.map((id) => id.split("::")[0]))];
  return ALLOWED_OVERLAPS.some((group) => primary.every((id) => group.includes(id)));
}

export function detectHotkeyConflicts(resolved?: Record<string, string>): HotkeyConflict[] {
  const store = resolved ?? useHotkeysStore.getState().overrides;
  const full: Record<string, string> = {};
  for (const command of HOTKEY_COMMANDS) {
    full[command.id] = store[command.id] ?? command.defaultHotkey;
    for (const alias of command.aliases ?? []) {
      full[`${command.id}::${alias}`] = alias;
    }
  }
  const byKey = new Map<string, string[]>();
  for (const [id, hotkey] of Object.entries(full)) {
    const key = canonicalizeHotkey(hotkey);
    const list = byKey.get(key) ?? [];
    list.push(id);
    byKey.set(key, list);
  }
  const conflicts: HotkeyConflict[] = [];
  for (const [key, ids] of byKey) {
    const primary = ids.filter((id) => !id.includes("::"));
    const aliasOwners = new Set(ids.map((id) => id.split("::")[0]));
    if (primary.length > 1 || (primary.length === 1 && aliasOwners.size > 1)) {
      if (!isAllowedOverlap(ids)) conflicts.push({ hotkey: key, ids: [...new Set(ids)] });
    }
  }
  return conflicts;
}

export function findHotkeyConflict(
  hotkey: string,
  ignoreId?: string,
  resolved?: Record<string, string>,
): string[] {
  const store = resolved ?? useHotkeysStore.getState().overrides;
  const wanted = canonicalizeHotkey(hotkey);
  const hits: string[] = [];
  for (const command of HOTKEY_COMMANDS) {
    if (command.id === ignoreId) continue;
    const candidates = [store[command.id] ?? command.defaultHotkey, ...(command.aliases ?? [])];
    if (candidates.some((candidate) => canonicalizeHotkey(candidate) === wanted)) {
      if (ignoreId && isAllowedOverlap([ignoreId, command.id])) continue;
      hits.push(command.id);
    }
  }
  return hits;
}

export function validateHotkeyInput(value: string): { valid: boolean; errors: string[] } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, errors: ["Leerer Hotkey"] };
  const result = validateHotkey(trimmed as Hotkey);
  return { valid: result.valid, errors: result.errors };
}
