import { FK_DRAWER_DEFAULT_WIDTH } from "@/lib/fk-drawer-stack";

export const PEEK = 54;
export const MIN_WIDTH = 480;
export const MAX_WIDTH = 1320;
export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function clampWidth(value: number, viewport: number) {
  const max = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, viewport - 64));
  return Math.min(max, Math.max(MIN_WIDTH, value));
}

export function defaultWidth(viewport: number) {
  return clampWidth(Math.max(FK_DRAWER_DEFAULT_WIDTH, Math.round(viewport * 0.68)), viewport);
}
