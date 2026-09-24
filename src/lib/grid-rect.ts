import type { Rect, Virtualizer } from "@tanstack/react-virtual";

export const lastGridRect: Rect = { width: 0, height: 0 };

export function rememberGridRect(instance: Virtualizer<HTMLDivElement, Element>) {
  if (!instance.scrollRect?.width || !instance.scrollRect.height) return;
  lastGridRect.width = instance.scrollRect.width;
  lastGridRect.height = instance.scrollRect.height;
}
