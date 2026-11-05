import { squarify } from "@/features/dashboard/charts/svg-geometry";
import { formatBytes } from "@/features/monitor/monitor-view/format";

export interface LabTable {
  name: string;
  group: string;
  bytes: number;
  rows: number;
  heat: number;
  weight: number;
}

export interface LabTile extends LabTable {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PREFIXES: [string, number][] = [
  ["ARTIKEL", 74],
  ["AUFTRAG", 68],
  ["LAGER", 46],
  ["BESTELLUNG", 38],
  ["SYS", 34],
  ["AUSWERTUNG", 30],
  ["BATCH", 24],
  ["ABRECHNUNG", 22],
  ["DMS", 20],
  ["ZZ", 18],
  ["INVENTUR", 16],
  ["PONY", 14],
  ["TA", 12],
  ["KUNDE", 26],
  ["LIEFERANT", 18],
  ["JOB", 10],
  ["WAREN", 9],
  ["TMP", 8],
];

const SUFFIXES = [
  "POS",
  "KOPF",
  "PREIS",
  "TEXT",
  "HIST",
  "LOG",
  "MERKMAL",
  "STATUS",
  "ZUORDNUNG",
  "PARAM",
  "VARIANTE",
  "BUCHUNG",
  "PROTOKOLL",
  "ARCHIV",
  "KONFIG",
  "IMPORT",
  "EXPORT",
  "SPERRE",
  "PLATZ",
  "GRUPPE",
];

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function buildTables(): LabTable[] {
  const next = random(517);
  const tables: Omit<LabTable, "heat" | "weight">[] = [];
  for (const [prefix, count] of PREFIXES) {
    const used = new Set<string>();
    for (let index = 0; tables.length < 517 && index < count; index++) {
      let name = `${prefix}_${SUFFIXES[Math.floor(next() * SUFFIXES.length)]}`;
      if (used.has(name)) name = `${name}_${index}`;
      used.add(name);
      const tail = next() ** 6;
      const bytes = Math.round(65_536 * (1 + tail * 140) * (prefix === "ZZ" ? 3 : 1));
      tables.push({ name, group: prefix, bytes, rows: Math.round(bytes / (60 + next() * 140)) });
    }
  }
  const largest = Math.max(...tables.map((table) => table.bytes));
  return tables
    .map((table) => ({
      ...table,
      heat: Math.sqrt(table.bytes / largest),
      weight: 1 + Math.log1p(table.bytes / 8192),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

export const LAB_TABLES = buildTables();

export function labLayout(
  tables: LabTable[],
  x: number,
  y: number,
  width: number,
  height: number,
): LabTile[] {
  return squarify(
    tables.map((table) => ({ ...table, value: table.weight })),
    x,
    y,
    width,
    height,
  ).map(({ item, x: left, y: top, width: w, height: h }) => ({
    ...item,
    x: left,
    y: top,
    w,
    h,
  }));
}

export interface LabGroup {
  name: string;
  tables: LabTable[];
  bytes: number;
}

export function labGroups(tables: LabTable[]): LabGroup[] {
  const groups = new Map<string, LabTable[]>();
  for (const table of tables) groups.set(table.group, [...(groups.get(table.group) ?? []), table]);
  const rest: LabTable[] = [];
  const result: LabGroup[] = [];
  for (const [name, members] of groups) {
    if (members.length < 3) rest.push(...members);
    else result.push({ name, tables: members, bytes: sum(members) });
  }
  if (rest.length) result.push({ name: "Sonstige", tables: rest, bytes: sum(rest) });
  return result.sort((a, b) => b.bytes - a.bytes);
}

function sum(tables: LabTable[]) {
  return tables.reduce((total, table) => total + table.bytes, 0);
}

export function labFacts(table: LabTable): string {
  return `${formatBytes(table.bytes)} · ≈ ${new Intl.NumberFormat("de-DE").format(table.rows)} Zeilen`;
}

const AURORA = [
  "radial-gradient(60% 75% at 0% 0%, var(--chart-1), transparent)",
  "linear-gradient(135deg, var(--chart-1), var(--chart-2) 55%, var(--chart-3))",
];

export function auroraStyle(
  tile: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  veil: number,
): React.CSSProperties {
  const span = `${(width / tile.w) * 100}% ${(height / tile.h) * 100}%`;
  const at = `${tile.w < width ? (tile.x / (width - tile.w)) * 100 : 0}% ${
    tile.h < height ? (tile.y / (height - tile.h)) * 100 : 0
  }%`;
  return {
    backgroundImage: [
      `linear-gradient(color-mix(in oklch, var(--card) ${Math.min(96, veil + 8)}%, transparent), color-mix(in oklch, var(--card) ${veil - 6}%, transparent))`,
      ...AURORA,
    ].join(", "),
    backgroundSize: ["100% 100%", ...AURORA.map(() => span)].join(", "),
    backgroundPosition: ["0 0", ...AURORA.map(() => at)].join(", "),
  };
}

export function placeStyle(
  tile: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): React.CSSProperties {
  return {
    left: `${(tile.x / width) * 100}%`,
    top: `${(tile.y / height) * 100}%`,
    width: `${(tile.w / width) * 100}%`,
    height: `${(tile.h / height) * 100}%`,
  };
}
