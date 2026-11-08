import { commandById } from "@/lib/hotkeys/commands";
import { formatHotkeyDisplay } from "@/lib/hotkeys/display";

export const MAX_HOTKEY_BADGES = 80;

const OPEN_DIALOG = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';
const HIDDEN = '[hidden], [aria-hidden="true"], [inert]';

export interface HotkeyBadge {
  id: string;
  label: string;
  left: number;
  top: number;
}

export interface BadgeViewport {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function hotkeyBadgeLabel(id: string, overrides: Record<string, string>): string | null {
  const command = commandById(id);
  if (!command) return null;
  return formatHotkeyDisplay(overrides[id] ?? command.defaultHotkey);
}

export function collectHotkeyBadges(
  root: ParentNode,
  viewport: BadgeViewport,
  labelFor: (id: string) => string | null,
  limit = MAX_HOTKEY_BADGES,
): HotkeyBadge[] {
  const dialogs = root.querySelectorAll(OPEN_DIALOG);
  const scope: ParentNode = dialogs.length > 0 ? dialogs[dialogs.length - 1] : root;
  const badges: HotkeyBadge[] = [];
  const labels = new Map<string, string | null>();
  for (const element of scope.querySelectorAll("[data-hotkey]")) {
    if (badges.length >= limit) break;
    const id = element.getAttribute("data-hotkey");
    if (!id) continue;
    let label = labels.get(id);
    if (label === undefined) {
      label = labelFor(id);
      labels.set(id, label);
    }
    if (!label) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom <= 0 || rect.right <= 0) continue;
    if (rect.top >= viewport.height || rect.left >= viewport.width) continue;
    if (element.closest(HIDDEN)) continue;
    badges.push({
      id,
      label,
      left: clamp(rect.right - 4, 16, viewport.width - 16),
      top: clamp(rect.top + 2, 10, viewport.height - 10),
    });
  }
  return badges;
}
