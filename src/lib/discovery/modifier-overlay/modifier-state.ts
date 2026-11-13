export const HOLD_MS = 700;

export type ModifierKey = "Meta" | "Control";

export type ModifierPhase = "idle" | "holding" | "shown";

export type ModifierInput =
  | {
      type: "keydown";
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      repeat: boolean;
      altGraph: boolean;
    }
  | { type: "keyup" }
  | { type: "elapsed" }
  | { type: "cancel" };

export function modifierKeyFor(platform: "mac" | "windows" | "linux"): ModifierKey {
  return platform === "mac" ? "Meta" : "Control";
}

function modifierAlone(input: Extract<ModifierInput, { type: "keydown" }>, modifier: ModifierKey) {
  if (input.key !== modifier || input.altKey || input.shiftKey || input.altGraph) return false;
  return modifier === "Meta" ? !input.ctrlKey : !input.metaKey;
}

export function nextModifierPhase(
  phase: ModifierPhase,
  input: ModifierInput,
  modifier: ModifierKey,
): ModifierPhase {
  if (input.type === "elapsed") return phase === "holding" ? "shown" : phase;
  if (input.type !== "keydown") return "idle";
  if (!modifierAlone(input, modifier)) return "idle";
  if (phase !== "idle" || input.repeat) return phase;
  return "holding";
}
