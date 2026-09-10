export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT = [0.42, 0, 0.58, 1] as const;
export const EASE_OUT_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";
export const SPRING = { type: "spring", stiffness: 170, damping: 24, mass: 1.2 } as const;
export const SPRING_PRESS = { type: "spring", stiffness: 520, damping: 32, mass: 0.6 } as const;
export const SPRING_LAYOUT = { type: "spring", stiffness: 380, damping: 34, mass: 0.8 } as const;
export const SPRING_SWAP = { type: "spring", stiffness: 420, damping: 32, mass: 0.7 } as const;
export const SPRING_PANEL = { type: "spring", stiffness: 320, damping: 36, mass: 0.85 } as const;
