import { create } from "zustand";
import { useSettingsStore } from "@/lib/settings";

export interface SpiderSpot {
  x: number;
  top: number;
  y: number;
}

export interface SpiderVisit extends SpiderSpot {
  id: number;
  quip: string;
  leaving?: boolean;
}

type DayStorage = Pick<Storage, "getItem" | "setItem">;

export const SPIDER_DELAY_MS = 2200;
export const SPIDER_PREVIEW_QUIP =
  "Probelauf! Vom 18. bis 31. Oktober schaue ich einmal am Tag in deine Ergebnisse.";

const VISIT_KEY = "l8db.seasonal.spider";
let visits = 0;
const AUTOMATED = typeof navigator !== "undefined" && navigator.webdriver === true;

export const useSeasonalStore = create<{ visit: SpiderVisit | null; preview: boolean }>(() => ({
  visit: null,
  preview: false,
}));

export function isHalloween(date: Date): boolean {
  return !AUTOMATED && date.getMonth() === 9 && date.getDate() >= 18;
}

export function useHalloween(): boolean {
  const enabled = useSettingsStore((state) => state.seasonalAccents);
  const preview = useSeasonalStore((state) => state.preview);
  return enabled && (preview || isHalloween(new Date()));
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function defaultStorage(): DayStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function spiderVisitedToday(date = new Date(), storage = defaultStorage()): boolean {
  try {
    return !storage || storage.getItem(VISIT_KEY) === dayKey(date);
  } catch {
    return true;
  }
}

export function claimSpiderVisit(date = new Date(), storage = defaultStorage()): boolean {
  if (!storage || spiderVisitedToday(date, storage)) return false;
  try {
    storage.setItem(VISIT_KEY, dayKey(date));
    return true;
  } catch {
    return false;
  }
}

export function visitSpider(spot: SpiderSpot, quip: string, preview = false): number {
  const id = ++visits;
  useSeasonalStore.setState({ preview, visit: { ...spot, id, quip } });
  return id;
}

export function leaveSpider(id: number): void {
  useSeasonalStore.setState((state) =>
    state.visit?.id === id ? { visit: { ...state.visit, leaving: true } } : state,
  );
}

export function endSpiderVisit(): void {
  useSeasonalStore.setState({ visit: null, preview: false });
}
