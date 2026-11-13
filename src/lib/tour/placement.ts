import type { TourSide } from "@/lib/tour/types";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  mascot: { x: number; y: number };
  bubble: { x: number; y: number };
  bubbleSide: "left" | "right";
  look: { x: number; y: number };
}

interface Options {
  target: Rect | null;
  viewport: Size;
  mascot: Size;
  bubble: Size;
  preferred?: TourSide;
  margin?: number;
  gap?: number;
}

const SIDES = ["right", "left", "bottom", "top"] as const;
type Side = (typeof SIDES)[number];
type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function overlap(a: Rect, b: Rect) {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function layout(
  anchorX: number,
  anchorY: number,
  bubbleSide: "left" | "right",
  { viewport, mascot, bubble, margin = 16, gap = 10 }: Options,
) {
  const unitWidth = mascot.width + gap + bubble.width;
  const unitHeight = Math.max(mascot.height, bubble.height);
  const unitLeft = clamp(
    bubbleSide === "right" ? anchorX : anchorX - unitWidth + mascot.width,
    margin,
    viewport.width - unitWidth - margin,
  );
  const mascotY = clamp(anchorY, margin, viewport.height - mascot.height - margin);
  const bubbleY = clamp(
    mascotY - 18,
    margin,
    viewport.height - Math.min(bubble.height, unitHeight) - margin,
  );
  const mascotX = bubbleSide === "right" ? unitLeft : unitLeft + bubble.width + gap;
  const bubbleX = bubbleSide === "right" ? unitLeft + mascot.width + gap : unitLeft;
  const box: Rect = {
    left: unitLeft,
    top: Math.min(mascotY, bubbleY),
    width: unitWidth,
    height: Math.max(mascotY + mascot.height, bubbleY + bubble.height) - Math.min(mascotY, bubbleY),
  };
  return { mascot: { x: mascotX, y: mascotY }, bubble: { x: bubbleX, y: bubbleY }, box };
}

function sideAnchor(side: Side, target: Rect, options: Options) {
  const { mascot, bubble, gap = 10, viewport } = options;
  const pad = 14;
  const centerY = target.top + target.height / 2 - mascot.height / 2;
  const centerX = target.left + target.width / 2;
  const unitWidth = mascot.width + gap + bubble.width;
  if (side === "right")
    return { x: target.left + target.width + pad, y: centerY, bubbleSide: "right" as const };
  if (side === "left")
    return { x: target.left - pad - mascot.width, y: centerY, bubbleSide: "left" as const };
  const bubbleSide = centerX + unitWidth <= viewport.width ? ("right" as const) : ("left" as const);
  const x = centerX - mascot.width / 2;
  const unitHeight = Math.max(mascot.height, bubble.height);
  if (side === "bottom") return { x, y: target.top + target.height + pad + 18, bubbleSide };
  return { x, y: target.top - pad - unitHeight + 18, bubbleSide };
}

function cornerAnchor(corner: Corner, options: Options) {
  const { viewport, mascot, margin = 16 } = options;
  const bubbleSide = corner.endsWith("right") ? ("left" as const) : ("right" as const);
  const x = corner.endsWith("right") ? viewport.width - margin - mascot.width : margin;
  const y = corner.startsWith("bottom") ? viewport.height - margin - mascot.height : margin + 18;
  return { x, y, bubbleSide };
}

function lookAt(from: { x: number; y: number }, mascot: Size, target: Rect | null) {
  if (!target) return { x: 0, y: 0 };
  const dx = target.left + target.width / 2 - (from.x + mascot.width / 2);
  const dy = target.top + target.height / 2 - (from.y + mascot.height / 2);
  const length = Math.hypot(dx, dy) || 1;
  return { x: Math.round((dx / length) * 100) / 100, y: Math.round((dy / length) * 100) / 100 };
}

export function tourPlacement(options: Options): Placement {
  const { target, viewport, mascot, bubble, preferred } = options;
  if (!target) {
    const unitWidth = mascot.width + (options.gap ?? 10) + bubble.width;
    const x = (viewport.width - unitWidth) / 2;
    const y = Math.max(viewport.height * 0.56 - bubble.height / 2, 16) + 18;
    const placed = layout(x, y, "right", options);
    return {
      mascot: placed.mascot,
      bubble: placed.bubble,
      bubbleSide: "right",
      look: { x: 0, y: 0 },
    };
  }
  const padded: Rect = {
    left: target.left - 8,
    top: target.top - 8,
    width: target.width + 16,
    height: target.height + 16,
  };
  const order: (Side | Corner)[] = [
    ...(preferred && preferred !== "over" ? [preferred] : []),
    ...SIDES.filter((side) => side !== preferred),
    "bottom-right",
    "bottom-left",
    "top-right",
    "top-left",
  ];
  const candidates = order.map((candidate, index) => {
    const anchor = (SIDES as readonly string[]).includes(candidate)
      ? sideAnchor(candidate as Side, target, options)
      : cornerAnchor(candidate as Corner, options);
    const placed = layout(anchor.x, anchor.y, anchor.bubbleSide, options);
    return {
      placed,
      bubbleSide: anchor.bubbleSide,
      cost: overlap(placed.box, padded) * 1000 + index,
    };
  });
  const chosen = candidates.reduce((best, next) => (next.cost < best.cost ? next : best));
  return {
    mascot: chosen.placed.mascot,
    bubble: chosen.placed.bubble,
    bubbleSide: chosen.bubbleSide,
    look: lookAt(chosen.placed.mascot, mascot, target),
  };
}
