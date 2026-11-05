import { drawBrawl } from "./transfer-brawl-draw";
import type { CinematicVariant } from "./transfer-cinematic-variant";

export const BRAWL_CAP = 240;
export const BRAWL_END = 22.4;
export type Move =
  | "jab"
  | "counter"
  | "rollback"
  | "bomb"
  | "chain"
  | "uppercut"
  | "laser"
  | "grab"
  | "slam";
export type Fighter = {
  x: number;
  y: number;
  angle: number;
  squash: number;
  reach: number;
  crouch: number;
  hurt: number;
};
export type BrawlParticle = {
  kind: "spark" | "data" | "letter" | "number";
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  text: string;
  color: string;
  size: number;
};
type Beat = { at: number; move: Move; side: number; power: number; letters: number };
export type BrawlScene = {
  t: number;
  real: number;
  seed: number;
  sourceName: string;
  targetName: string;
  source: Fighter;
  target: Fighter;
  particles: BrawlParticle[];
  peak: number;
  event: number;
  launched: number;
  stolen: number;
  rows: number;
  sourceHp: number;
  targetHp: number;
  combo: number;
  lastHit: number;
  move: Move;
  moveAt: number;
  hitstop: number;
  shake: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  ko: boolean;
  rollback: boolean;
  counterHits: number;
};
const BEATS: Beat[] = [
  { at: 2.8, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 3.15, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 3.5, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 4.2, move: "counter", side: 1, power: 1.6, letters: 0 },
  { at: 4.65, move: "counter", side: 1, power: 1.4, letters: 0 },
  { at: 5.6, move: "jab", side: 0, power: 1.2, letters: 0 },
  { at: 5.95, move: "rollback", side: 1, power: 0.5, letters: 0 },
  { at: 7.35, move: "bomb", side: 1, power: 2, letters: 0 },
  { at: 8.2, move: "bomb", side: 1, power: 1, letters: 0 },
  { at: 9.55, move: "chain", side: 1, power: 2.2, letters: 0 },
  { at: 11.2, move: "uppercut", side: 0, power: 2.6, letters: 2 },
  { at: 13.2, move: "laser", side: 0, power: 1.5, letters: 2 },
  { at: 13.45, move: "laser", side: 0, power: 1, letters: 1 },
  { at: 13.7, move: "laser", side: 0, power: 1, letters: 1 },
  { at: 14.6, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 14.85, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 15.1, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 15.35, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 15.6, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 15.85, move: "jab", side: 0, power: 1, letters: 1 },
  { at: 17.4, move: "grab", side: 0, power: 0.4, letters: 0 },
  { at: 19.2, move: "slam", side: 0, power: 4, letters: 16 },
];
type Key = [number, number, number, number, number, number, number];
const SOURCE_KEYS: Key[] = [
  [0, 220, 410, 0, 1, 0, 0],
  [1.8, 275, 410, 0, 1, 0, 0],
  [2.5, 435, 410, -0.12, 0.9, -15, 10],
  [3.8, 445, 410, 0.12, 1, 70, 0],
  [4.8, 170, 410, -0.28, 0.88, 0, 0],
  [5.4, 410, 410, -0.15, 0.82, -10, 20],
  [5.7, 455, 410, 0.12, 1, 75, 0],
  [6.5, 365, 410, -0.15, 1, 0, 0],
  [7.5, 175, 410, -0.3, 0.8, 0, 0],
  [8.1, 295, 410, 0, 0.55, 0, 45],
  [8.7, 340, 410, 0, 1, 0, 0],
  [9.9, 125, 410, -0.3, 0.9, 0, 0],
  [10.5, 195, 410, -0.2, 0.65, -20, 30],
  [11.15, 535, 360, -0.3, 1.15, 70, 0],
  [11.6, 570, 300, -0.12, 1.1, 45, 0],
  [12.2, 490, 410, 0, 0.88, 0, 0],
  [12.65, 420, 410, -0.18, 0.84, -10, 12],
  [13.1, 435, 410, 0.15, 1.1, 0, 0],
  [14.2, 435, 410, 0, 1, 0, 0],
  [14.5, 600, 410, -0.1, 0.85, -10, 10],
  [16, 650, 410, 0.14, 1, 70, 0],
  [16.6, 545, 410, -0.2, 0.7, -20, 20],
  [17.4, 625, 410, 0, 0.8, 65, 10],
  [18, 615, 340, -0.6, 1.1, 55, 0],
  [18.6, 615, 305, -2.4, 1, 55, 0],
  [19.2, 615, 410, -5.8, 0.72, 45, 10],
  [19.8, 590, 410, -Math.PI * 2, 1, 0, 0],
  [22.4, 580, 410, -Math.PI * 2, 1, 0, 0],
];
const TARGET_KEYS: Key[] = [
  [0, 740, 410, 0, 1, 0, 0],
  [1.8, 690, 410, 0, 1, 0, 0],
  [2.5, 565, 410, 0, 1, 0, 0],
  [3.8, 610, 410, -0.24, 0.9, 0, 0],
  [4.1, 425, 410, -0.1, 0.85, -10, 15],
  [4.7, 335, 410, 0.18, 1.1, 70, 0],
  [5.3, 560, 410, 0, 1, 0, 0],
  [5.65, 590, 410, -0.2, 0.8, 0, 0],
  [6.25, 550, 410, 0, 1, 0, 0],
  [6.8, 660, 410, -0.18, 0.85, -20, 0],
  [7.2, 660, 410, 0.18, 1.1, 65, 0],
  [8.6, 660, 410, 0, 1, 0, 0],
  [9.3, 610, 410, -0.2, 0.9, -20, 0],
  [9.65, 580, 410, 0.2, 1, 70, 0],
  [10.5, 680, 410, 0, 1, 0, 0],
  [11.2, 650, 360, -0.4, 1.2, 0, 0],
  [11.75, 765, 235, -0.8, 1.05, 0, 0],
  [12.3, 815, 410, -0.3, 0.65, 0, 20],
  [12.7, 745, 410, 0.18, 1, 0, 0],
  [14, 775, 410, -0.2, 0.9, 0, 0],
  [16, 835, 410, -0.3, 0.8, 0, 15],
  [16.5, 745, 410, 0.15, 1, 0, 0],
  [17.4, 710, 410, -0.35, 0.8, 0, 0],
  [18, 660, 240, -1.7, 1.1, 0, 0],
  [18.6, 540, 260, -3.8, 1.15, 0, 0],
  [19.2, 690, 410, -Math.PI * 2, 0.22, 0, 0],
  [19.65, 730, 410, -Math.PI * 2, 0.3, 0, 0],
  [22.4, 730, 410, -Math.PI * 2, 0.22, 0, 0],
];
export function clamp(v: number) {
  return Math.max(0, Math.min(1, v));
}
function smooth(v: number) {
  const k = clamp(v);
  return k * k * (3 - 2 * k);
}
function pose(f: Fighter, keys: Key[], t: number) {
  let i = 1;
  while (i < keys.length - 1 && keys[i][0] < t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const k = smooth((t - a[0]) / (b[0] - a[0]));
  f.x = a[1] + (b[1] - a[1]) * k;
  f.y = a[2] + (b[2] - a[2]) * k;
  f.angle = a[3] + (b[3] - a[3]) * k;
  f.squash = a[4] + (b[4] - a[4]) * k;
  f.reach = a[5] + (b[5] - a[5]) * k;
  f.crouch = a[6] + (b[6] - a[6]) * k;
}
function random(s: BrawlScene) {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let v = s.seed;
  v = Math.imul(v ^ (v >>> 15), v | 1);
  v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
}
function particle(
  s: BrawlScene,
  kind: BrawlParticle["kind"],
  x: number,
  y: number,
  text: string,
  color: string,
  life = 0.75,
) {
  if (s.particles.length >= BRAWL_CAP) return;
  s.particles.push({
    kind,
    x,
    y,
    ox: x,
    oy: y,
    vx: (random(s) - 0.5) * 420,
    vy: -80 - random(s) * 220,
    age: 0,
    life,
    text,
    color,
    size: 2 + random(s) * 4,
  });
}
function hit(s: BrawlScene, b: Beat) {
  s.move = b.move;
  s.moveAt = s.t;
  s.lastHit = s.t;
  s.shake = 4 * b.power;
  s.hitstop = b.power > 2 ? 0.105 : 0.065;
  const victim = b.side ? s.source : s.target;
  victim.hurt = 1;
  if (b.move === "rollback") {
    s.targetHp = Math.min(1, s.targetHp + 0.055);
    s.rollback = true;
  } else if (b.side) {
    s.sourceHp = Math.max(0.28, s.sourceHp - 0.085 * b.power);
    s.counterHits++;
    s.combo = 0;
  } else {
    s.targetHp = Math.max(0.06, s.targetHp - b.power * 0.034);
    s.combo += b.move === "uppercut" ? 3 : b.move === "grab" || b.move === "slam" ? 0 : 1;
    s.rows += Math.round(b.power * 4200);
  }
  if (b.move === "slam") {
    s.ko = true;
    s.targetHp = 0;
    s.rows = 128000;
  }
  const x = victim.x;
  const y = victim.y - 90;
  for (let i = 0; i < 12 * b.power; i++)
    particle(s, "spark", x, y, "", b.side ? "#ff7190" : "#ffe88b");
  particle(
    s,
    "number",
    x + (s.event % 2 ? 28 : -28),
    Math.max(145, y - 40),
    b.move === "rollback"
      ? "+1 LEBEN?"
      : b.side
        ? "CACHE MISS!"
        : `+${Math.round(b.power * 4200).toLocaleString("de-DE")} Zeilen`,
    "#fff3ac",
    1.1,
  );
  const number = s.particles[s.particles.length - 1];
  if (number?.kind === "number") {
    number.vx = 0;
    number.vy = -90;
  }
  if (!b.side) {
    for (let i = 0; i < 9; i++)
      particle(s, "data", x, y, i % 2 ? "{row}" : "▦", "#96f3ce", 1.1 + random(s) * 0.5);
    const end = Math.min(s.targetName.length, s.launched + b.letters);
    while (s.launched < end) {
      particle(s, "letter", x, y - 55, s.targetName[s.launched++], "#fff4b5", 1.1);
    }
  }
}
export function createBrawl(sourceName: string, targetName: string, seed = 7): BrawlScene {
  const fighter = (): Fighter => ({
    x: 0,
    y: 410,
    angle: 0,
    squash: 1,
    reach: 0,
    crouch: 0,
    hurt: 0,
  });
  const s: BrawlScene = {
    t: 0,
    real: 0,
    seed,
    sourceName,
    targetName,
    source: fighter(),
    target: fighter(),
    particles: [],
    peak: 0,
    event: 0,
    launched: 0,
    stolen: 0,
    rows: 0,
    sourceHp: 1,
    targetHp: 1,
    combo: 0,
    lastHit: -10,
    move: "jab",
    moveAt: -10,
    hitstop: 0,
    shake: 0,
    cameraX: 480,
    cameraY: 270,
    zoom: 1,
    ko: false,
    rollback: false,
    counterHits: 0,
  };
  pose(s.source, SOURCE_KEYS, 0);
  pose(s.target, TARGET_KEYS, 0);
  return s;
}
function tick(s: BrawlScene, dt: number) {
  s.real += dt;
  s.shake *= Math.exp(-dt * 9);
  const freeze = Math.min(s.hitstop, dt);
  s.hitstop -= freeze;
  const speed = s.t >= 17.6 && s.t < 18.7 ? 0.52 : 1;
  const advance = (dt - freeze) * speed;
  s.t = Math.min(BRAWL_END, s.t + advance);
  pose(s.source, SOURCE_KEYS, s.t);
  pose(s.target, TARGET_KEYS, s.t);
  s.source.hurt *= Math.exp(-advance * 8);
  s.target.hurt *= Math.exp(-advance * 8);
  while (s.event < BEATS.length && s.t >= BEATS[s.event].at) hit(s, BEATS[s.event++]);
  const focus = (s.source.x + s.target.x) / 2;
  const big = s.t > 17 && s.t < 19.6;
  const desiredZoom = big
    ? 1.18
    : Math.min(1.12, 720 / Math.max(600, Math.abs(s.source.x - s.target.x) + 300));
  const k = 1 - Math.exp(-dt * 4);
  s.zoom += (desiredZoom - s.zoom) * k;
  s.cameraX += (Math.max(420, Math.min(590, focus)) - s.cameraX) * k;
  const desiredY = s.t > 10.7 && s.t < 12.25 ? 215 : big ? 260 : 285;
  s.cameraY += (desiredY - s.cameraY) * k;
  let write = 0;
  for (const p of s.particles) {
    p.age += advance || (s.t >= BRAWL_END ? dt : 0);
    if (p.age >= p.life) {
      if (p.kind === "letter") s.stolen++;
      continue;
    }
    const u = clamp(p.age / p.life);
    if (p.kind === "letter" || p.kind === "data") {
      const ease = smooth(u);
      p.x = p.ox + (s.source.x - p.ox) * ease;
      p.y =
        p.oy +
        (s.source.y - 85 - p.oy) * ease -
        Math.sin(u * Math.PI) * (p.kind === "letter" ? 150 : 70);
    } else {
      p.x += p.vx * advance;
      p.y += p.vy * advance;
      if (p.kind === "spark") p.vy += 650 * advance;
    }
    s.particles[write++] = p;
  }
  s.particles.length = write;
  s.peak = Math.max(s.peak, write);
}
export function stepBrawl(s: BrawlScene, dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  let left = Math.min(dt, 1);
  while (left > 0.000001) {
    const delta = Math.min(left, 1 / 120);
    tick(s, delta);
    left -= delta;
  }
}
export function brawlPhase(t: number) {
  if (t < 2.4) return "Runde 1";
  if (t < 5.4) return "Schlagabtausch";
  if (t < 6.7) return "ROLLBACK";
  if (t < 8.8) return "NULL-Bomben";
  if (t < 10.5) return "Foreign Key";
  if (t < 12.5) return "Dash-Uppercut";
  if (t < 14.3) return "INDEX-Scan";
  if (t < 16.5) return "Namens-Combo";
  if (t < 19.2) return "JOIN-Suplex";
  return "K.O. – Transfer fertig";
}
export const brawlVariant: CinematicVariant = {
  id: "brawl",
  label: "Prügelei",
  description: "Zwei Datenbanken. Ein Dach. Keine referenzielle Integrität.",
  jumps: [
    { label: "Runde 1", at: 0 },
    { label: "Schlagabtausch", at: 3 },
    { label: "ROLLBACK", at: 6.1 },
    { label: "NULL-Bomben", at: 7.2 },
    { label: "Foreign Key", at: 9.4 },
    { label: "Uppercut", at: 11.4 },
    { label: "INDEX-Scan", at: 13.3 },
    { label: "12-Hit-Combo", at: 16.1 },
    { label: "JOIN-Suplex", at: 18.3 },
    { label: "K.O.", at: 20.5 },
  ],
  create(sourceName, targetName, seed) {
    const s = createBrawl(sourceName, targetName, seed);
    return {
      time: () => s.t,
      phase: () => brawlPhase(s.t),
      finished: () => s.t >= BRAWL_END,
      step: (dt) => stepBrawl(s, dt),
      draw: (ctx) => drawBrawl(ctx, s),
    };
  },
};
