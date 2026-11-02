import { create } from "zustand";
import { type HolidayId, holidayForDate } from "@/lib/seasonal-calendar";
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
  holiday?: HolidayId;
}

type DayStorage = Pick<Storage, "getItem" | "setItem">;

export const SPIDER_DELAY_MS = 2200;
export const SPIDER_PREVIEW_QUIP =
  "Probelauf! Vom 18. bis 31. Oktober schaue ich einmal am Tag in deine Ergebnisse.";

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
  return useHoliday() === "halloween";
}

export function currentHoliday(date = new Date()): HolidayId | null {
  return AUTOMATED ? null : holidayForDate(date);
}

export function useHoliday(): HolidayId | null {
  const enabled = useSettingsStore((state) => state.seasonalAccents);
  const previewHoliday = useSeasonalStore((state) =>
    state.preview ? (state.visit?.holiday ?? "halloween") : null,
  );
  return enabled ? (previewHoliday ?? currentHoliday()) : null;
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
  return holidayVisitedToday("halloween", date, storage);
}

function visitKey(holiday: HolidayId): string {
  return `l8db.seasonal.${holiday === "halloween" ? "spider" : holiday}`;
}

export function holidayVisitedToday(
  holiday: HolidayId,
  date = new Date(),
  storage = defaultStorage(),
): boolean {
  try {
    return !storage || storage.getItem(visitKey(holiday)) === dayKey(date);
  } catch {
    return true;
  }
}

export function claimSpiderVisit(date = new Date(), storage = defaultStorage()): boolean {
  return claimHolidayVisit("halloween", date, storage);
}

export function claimHolidayVisit(
  holiday: HolidayId,
  date = new Date(),
  storage = defaultStorage(),
): boolean {
  if (!storage || holidayVisitedToday(holiday, date, storage)) return false;
  try {
    storage.setItem(visitKey(holiday), dayKey(date));
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

export function visitHoliday(
  holiday: HolidayId,
  spot: SpiderSpot,
  quip: string,
  preview = false,
): number {
  const id = ++visits;
  useSeasonalStore.setState({ preview, visit: { ...spot, id, quip, holiday } });
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
