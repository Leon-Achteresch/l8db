import { homeDir } from "@tauri-apps/api/path";
import { CircleSlash, type LucideIcon } from "lucide-react";
import { create } from "zustand";
import type { AppTask } from "@/lib/tasks";

export type IslandTone = "neutral" | "success" | "error" | "warning" | "celebrate";

export type IslandGlyph =
  | { kind: "search" }
  | { kind: "dot"; color: string }
  | { kind: "wave"; color?: string }
  | { kind: "ring"; percent: number }
  | { kind: "check" }
  | { kind: "cross" }
  | { kind: "emoji"; emoji: string; effect: "wave" | "pop" }
  | { kind: "icon"; icon: LucideIcon };

export interface IslandView {
  key: string;
  glyph: IslandGlyph;
  title: string;
  detail?: string;
  label?: string;
  tone?: IslandTone;
  since?: number;
  percent?: number;
  more?: number;
  idle?: boolean;
  duration?: number;
  action?: { label: string; run: () => void };
}

export type IslandMoment = IslandView & { duration: number };

interface Greeting {
  emoji: string;
  text: string;
  end?: string;
  detail?: string;
  anonymous?: boolean;
}

export const ISLAND_TASK_DELAY = 500;
export const ISLAND_QUEUE_LIMIT = 6;
export const QUERY_MILESTONES = [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000];

const VERSION_KEY = "l8db.island.version";
const QUERIES_KEY = "l8db.island.queries";
const CHEERS = ["Respekt!", "Läuft bei dir.", "SELECT * FROM erfolge;"];
const GENERIC_ACCOUNTS = new Set([
  "admin",
  "administrator",
  "root",
  "user",
  "guest",
  "default",
  "public",
  "runner",
  "ubuntu",
  "vagrant",
]);

const DAYPARTS: { until: number; emoji: string; phrases: Pick<Greeting, "text" | "end">[] }[] = [
  {
    until: 5,
    emoji: "🌙",
    phrases: [
      { text: "Noch wach", end: "?" },
      { text: "Nachtschicht", end: "?" },
    ],
  },
  { until: 12, emoji: "☀️", phrases: [{ text: "Guten Morgen" }, { text: "Moin" }] },
  { until: 14, emoji: "🍝", phrases: [{ text: "Mahlzeit" }] },
  {
    until: 18,
    emoji: "👋",
    phrases: [{ text: "Hallo" }, { text: "Servus" }, { text: "Guten Tag" }],
  },
  { until: 22, emoji: "🌆", phrases: [{ text: "Guten Abend" }, { text: "N'Abend" }] },
  {
    until: 24,
    emoji: "🌙",
    phrases: [
      { text: "Späte Schicht", end: "?" },
      { text: "Noch fleißig", end: "?" },
    ],
  },
];

const SPECIAL_DAYS: Record<string, Greeting> = {
  "1-1": { emoji: "🎆", text: "Frohes neues Jahr", end: "!" },
  "3-14": { emoji: "🥧", text: "Happy Pi Day", detail: "π ≈ 3,14159" },
  "3-31": { emoji: "💾", text: "World Backup Day", detail: "Schon gesichert?", anonymous: true },
  "4-1": { emoji: "🃏", text: "SELECT 'April, April!';", anonymous: true },
  "5-4": { emoji: "✨", text: "May the 4th be with you" },
  "10-31": { emoji: "🎃", text: "Happy Halloween", detail: "Keine Geister-Locks heute" },
  "12-24": { emoji: "🎄", text: "Frohe Weihnachten" },
  "12-25": { emoji: "🎄", text: "Frohe Weihnachten" },
  "12-26": { emoji: "🎄", text: "Frohe Weihnachten" },
  "12-31": { emoji: "🥂", text: "Guten Rutsch", end: "!" },
};

export const useIslandStore = create<{ queue: IslandMoment[] }>(() => ({ queue: [] }));

export function showIslandMoment(moment: IslandMoment): void {
  useIslandStore.setState((state) => {
    const queue = [...state.queue.filter((entry) => entry.key !== moment.key), moment];
    if (queue.length > ISLAND_QUEUE_LIMIT) queue.splice(1, queue.length - ISLAND_QUEUE_LIMIT);
    return { queue };
  });
}

export function dismissIslandMoment(key: string): void {
  useIslandStore.setState((state) => ({ queue: state.queue.filter((entry) => entry.key !== key) }));
}

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function named(text: string, name: string | null, end = ""): string {
  return `${text}${name ? `, ${name}` : ""}${end}`;
}

function dayOfYear(date: Date): number {
  const year = date.getFullYear();
  return Math.round(
    (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / 86_400_000,
  );
}

function specialDay(date: Date): Greeting | null {
  if (dayOfYear(date) === 256)
    return { emoji: "💾", text: "Happy Programmer's Day", detail: "Tag 0x100" };
  if (date.getMonth() === 6 && date.getDay() === 5 && date.getDate() > 24)
    return { emoji: "🖥️", text: "Happy SysAdmin Day", detail: "Danke fürs Am-Laufen-Halten" };
  return SPECIAL_DAYS[`${date.getMonth() + 1}-${date.getDate()}`] ?? null;
}

function weekdayNote(date: Date): string | undefined {
  const day = date.getDay();
  if (day === 0 || day === 6) return "Wochenendschicht? Respekt.";
  if (day === 1 && date.getHours() < 12) return "Neue Woche, neue Queries";
  if (day === 5 && date.getHours() >= 12) return "Fast Wochenende";
  return undefined;
}

export function greetingName(home: unknown): string | null {
  const account = (typeof home === "string" ? home : "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  const first = account.split(/[._\s-]/)[0] ?? "";
  if (first.length < 2 || !/^\p{L}+$/u.test(first) || GENERIC_ACCOUNTS.has(first.toLowerCase()))
    return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

let accountName: Promise<string | null> | undefined;

export function islandName(): Promise<string | null> {
  accountName ??= homeDir().then(greetingName, () => null);
  return accountName;
}

export function greetingMoment(
  date: Date,
  name: string | null,
  pick = Math.random(),
): IslandMoment {
  const special = specialDay(date);
  if (special)
    return {
      key: "greeting",
      glyph: { kind: "emoji", emoji: special.emoji, effect: "pop" },
      title: named(special.text, special.anonymous ? null : name, special.end),
      detail: special.detail,
      tone: "celebrate",
      duration: 5000,
    };
  const part = DAYPARTS.find((entry) => date.getHours() < entry.until) ?? DAYPARTS[0];
  const phrase = part.phrases[Math.floor(pick * part.phrases.length)] ?? part.phrases[0];
  return {
    key: "greeting",
    glyph: { kind: "emoji", emoji: part.emoji, effect: "wave" },
    title: named(phrase.text, name, phrase.end),
    detail: weekdayNote(date),
    duration: 4200,
  };
}

export function welcomeBackMoment(date: Date, name: string | null, away: number): IslandMoment {
  if (away >= 6 * 3_600_000) return greetingMoment(date, name);
  return {
    key: "greeting",
    glyph: { kind: "emoji", emoji: "👋", effect: "wave" },
    title: named("Willkommen zurück", name),
    duration: 3500,
  };
}

export function onboardedMoment(name: string | null): IslandMoment {
  return {
    key: "greeting",
    glyph: { kind: "emoji", emoji: "🎉", effect: "pop" },
    title: named("Willkommen bei l8db", name),
    detail: "Schön, dass du da bist",
    tone: "celebrate",
    duration: 5000,
  };
}

export function versionMoment(version: string, openNotes: () => void): IslandMoment {
  return {
    key: "version",
    glyph: { kind: "emoji", emoji: "✨", effect: "pop" },
    title: `Willkommen in v${version}`,
    tone: "celebrate",
    duration: 6000,
    action: { label: "Neuigkeiten", run: openNotes },
  };
}

export function takeVersionChange(version: string | null): string | null {
  if (!version) return null;
  const previous = readItem(VERSION_KEY);
  if (previous === version) return null;
  writeItem(VERSION_KEY, version);
  return previous ? version : null;
}

export function formatIslandDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`;
}

export function taskMoment(task: AppTask): IslandMoment | null {
  const elapsed = (task.finishedAt ?? Date.now()) - task.startedAt;
  if (elapsed < ISLAND_TASK_DELAY || task.status === "interrupted") return null;
  const key = `done:${task.id}`;
  if (task.status === "success")
    return {
      key,
      glyph: { kind: "check" },
      title: task.title,
      detail: formatIslandDuration(elapsed),
      tone: "success",
      duration: 2400,
    };
  if (task.status === "error")
    return {
      key,
      glyph: { kind: "cross" },
      title: task.title,
      detail: "fehlgeschlagen",
      tone: "error",
      duration: 3200,
    };
  return {
    key,
    glyph: { kind: "icon", icon: CircleSlash },
    title: task.title,
    detail: "abgebrochen",
    duration: 2400,
  };
}

export function milestoneMoment(count: number): IslandMoment {
  return {
    key: `milestone:${count}`,
    glyph: { kind: "emoji", emoji: "🎉", effect: "pop" },
    title: `${count.toLocaleString("de-DE")} Abfragen`,
    detail: CHEERS[Math.max(0, QUERY_MILESTONES.indexOf(count)) % CHEERS.length],
    tone: "celebrate",
    duration: 4500,
  };
}

export function countQuery(): number | null {
  const count = (Number(readItem(QUERIES_KEY)) || 0) + 1;
  writeItem(QUERIES_KEY, String(count));
  return QUERY_MILESTONES.includes(count) ? count : null;
}

export function productionQuip(date: Date): IslandMoment | null {
  const hour = date.getHours();
  const friday = date.getDay() === 5 && hour >= 12;
  if (!friday && hour >= 5 && hour < 22) return null;
  return {
    key: "production",
    glyph: { kind: "emoji", emoji: friday ? "🫣" : "🦉", effect: "pop" },
    title: friday
      ? "Freitag + Produktion"
      : `Produktion um ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`,
    detail: friday ? "Was soll schon schiefgehen?" : "Mutig.",
    tone: "warning",
    duration: 4500,
  };
}

export function previewIsland(name: string | null): void {
  const start = Date.now();
  const moments: IslandMoment[] = [
    { ...greetingMoment(new Date(start), name), key: "preview:greeting", duration: 3000 },
    {
      key: "preview:task",
      glyph: { kind: "wave" },
      title: "SQL-Abfrage",
      detail: "Vorschau",
      since: start + 3000,
      duration: 3500,
    },
    {
      key: "preview:update",
      glyph: { kind: "ring", percent: 68 },
      title: "Update wird geladen",
      percent: 68,
      duration: 2600,
    },
    {
      key: "preview:done",
      glyph: { kind: "check" },
      title: "SQL-Abfrage",
      detail: formatIslandDuration(2400),
      tone: "success",
      duration: 2200,
    },
    { ...milestoneMoment(1_000), key: "preview:milestone" },
  ];
  for (const moment of moments) showIslandMoment(moment);
}
