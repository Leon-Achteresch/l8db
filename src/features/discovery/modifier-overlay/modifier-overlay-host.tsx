import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  collectHotkeyBadges,
  type HotkeyBadge,
  hotkeyBadgeLabel,
} from "@/lib/discovery/modifier-overlay/hotkey-badges";
import { installModifierOverlay } from "@/lib/discovery/modifier-overlay/install";
import { modifierKeyFor } from "@/lib/discovery/modifier-overlay/modifier-state";
import { useModifierOverlayStore } from "@/lib/discovery/modifier-overlay/settings";
import { detectHotkeyPlatform } from "@/lib/hotkeys/display";
import { useHotkeysStore } from "@/lib/hotkeys/use-hotkeys-store";

export function ModifierOverlayHost() {
  const enabled = useModifierOverlayStore((state) => state.enabled);
  const [badges, setBadges] = useState<HotkeyBadge[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return installModifierOverlay({
      modifier: modifierKeyFor(detectHotkeyPlatform()),
      onShow: () => {
        const { overrides } = useHotkeysStore.getState();
        setBadges(
          collectHotkeyBadges(
            document,
            { width: window.innerWidth, height: window.innerHeight },
            (id) => hotkeyBadgeLabel(id, overrides),
          ),
        );
      },
      onHide: () => setBadges(null),
    });
  }, [enabled]);

  if (!badges?.length) return null;
  return createPortal(
    <div
      aria-hidden
      data-modifier-overlay=""
      className="pointer-events-none fixed inset-0 z-[2147483000]"
    >
      {badges.map((badge) => (
        <kbd
          key={`${badge.id}:${badge.left}:${badge.top}`}
          style={{ left: badge.left, top: badge.top }}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-sans text-[10px] leading-none font-medium whitespace-nowrap text-background shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
        >
          {badge.label}
        </kbd>
      ))}
    </div>,
    document.body,
  );
}
