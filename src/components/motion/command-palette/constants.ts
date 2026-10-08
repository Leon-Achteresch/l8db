// Opened via a keyboard shortcut many times a day — entrance must read as
// instant. Tight spring, even faster exit.
export const PANEL_SPRING = {
  type: "spring",
  stiffness: 560,
  damping: 40,
  mass: 0.5,
} as const;

export const LIST_HEIGHT_SPRING = {
  stiffness: 520,
  damping: 46,
  mass: 1,
  restDelta: 0.5,
} as const;
