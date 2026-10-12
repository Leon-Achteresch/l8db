import { type Hotkey, matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import type { KeyboardEvent } from "react";
import { detectHotkeyPlatform } from "./display";

export const MENU_KEYS = {
  open: "Enter",
  openInNewTab: "Mod+Enter",
  newQuery: "Mod+Alt+N",
  copyName: "Mod+C",
  copyQualifiedName: "Mod+Alt+C",
  rename: "F2",
  drop: "Mod+Backspace",
} as const;

export type MenuKeyActions = Partial<Record<Exclude<keyof typeof MENU_KEYS, "open">, () => void>>;

export function menuKeyHandler(actions: MenuKeyActions) {
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const platform = detectHotkeyPlatform();
    for (const [id, action] of Object.entries(actions)) {
      const hotkey = MENU_KEYS[id as keyof MenuKeyActions] as Hotkey;
      if (!action || !matchesKeyboardEvent(event.nativeEvent, hotkey, platform)) continue;
      event.preventDefault();
      event.stopPropagation();
      action();
      return;
    }
  };
}
