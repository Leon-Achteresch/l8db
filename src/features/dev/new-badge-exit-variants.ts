import type { Easing, TargetAndTransition } from "motion/react";

const RISE: Easing = [0.22, 1, 0.36, 1];
const FALL: Easing = [0.55, 0, 1, 0.45];

export interface BadgeExitVariant {
  id: string;
  title: string;
  description: string;
  duration: number;
  times: number[];
  ease: Easing[];
  fadeFrom: number;
  origin: string;
  exit: TargetAndTransition;
}

export const BADGE_EXIT_VARIANTS: BadgeExitVariant[] = [
  {
    id: "hop",
    title: "01 · Hüpfer",
    description:
      "Duckt sich kurz, springt hoch und fällt gerade nach unten weg. Die ruhigste Variante.",
    duration: 0.62,
    times: [0, 0.18, 0.5, 1],
    ease: [RISE, RISE, FALL],
    fadeFrom: 0.78,
    origin: "50% 100%",
    exit: {
      y: [0, 1.5, -9, 26],
      scaleX: [1, 1.14, 0.94, 0.96],
      scaleY: [1, 0.8, 1.12, 1.06],
    },
  },
  {
    id: "tumble",
    title: "02 · Trudeln",
    description:
      "Springt hoch, kippt über die Kante und dreht sich im Fallen zur Seite weg, wie ein abgefallenes Schild.",
    duration: 0.72,
    times: [0, 0.16, 0.46, 1],
    ease: [RISE, RISE, FALL],
    fadeFrom: 0.8,
    origin: "50% 50%",
    exit: {
      y: [0, 1.5, -11, 30],
      x: [0, 0, 3, 14],
      rotate: [0, -5, 10, 80],
      scaleY: [1, 0.85, 1.05, 1],
    },
  },
  {
    id: "coyote",
    title: "03 · Coyote",
    description:
      "Springt hoch, bleibt einen Moment in der Luft hängen, zappelt und stürzt dann langgezogen ab.",
    duration: 0.95,
    times: [0, 0.2, 0.36, 0.5, 0.64, 1],
    ease: [RISE, "linear", "linear", "linear", FALL],
    fadeFrom: 0.88,
    origin: "50% 0%",
    exit: {
      y: [0, -11, -11, -11, -10, 36],
      rotate: [0, 0, -7, 7, 0, 0],
      scaleX: [1, 0.95, 1, 1, 1, 0.78],
      scaleY: [1, 1.1, 1, 1, 1, 1.45],
    },
  },
  {
    id: "splat",
    title: "04 · Platsch",
    description:
      "Springt hoch, fällt auf die Zeilenkante und wird dort platt gedrückt, bevor es verschwindet.",
    duration: 0.66,
    times: [0, 0.3, 0.62, 0.74, 1],
    ease: [RISE, FALL, RISE, "linear"],
    fadeFrom: 0.8,
    origin: "50% 100%",
    exit: {
      y: [0, -9, 13, 13, 13],
      scaleX: [1, 0.94, 0.95, 1.5, 1.7],
      scaleY: [1, 1.12, 1.15, 0.4, 0.15],
    },
  },
];
