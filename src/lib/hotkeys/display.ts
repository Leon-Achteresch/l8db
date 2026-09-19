import { formatForDisplay, type Hotkey } from "@tanstack/react-hotkeys";

export function detectHotkeyPlatform(): "mac" | "windows" | "linux" {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return "mac";
  if (/Win/i.test(platform)) return "windows";
  if (/Linux/i.test(userAgent) || /Linux/i.test(platform)) return "linux";
  return "windows";
}

export function formatHotkeyDisplay(hotkey: string): string {
  try {
    return formatForDisplay(hotkey as Hotkey, { platform: detectHotkeyPlatform() });
  } catch {
    return hotkey;
  }
}

export function splitHotkeyForKbd(hotkey: string): string[] {
  const display = formatHotkeyDisplay(hotkey);
  if (display.includes("+")) return display.split("+").map((part) => part.trim());
  return display
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}
