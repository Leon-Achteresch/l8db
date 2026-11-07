export const STAGE_W = 960;
export const STAGE_H = 540;
export const GROUND = 430;
export const SOURCE_X = 230;
export const TARGET_X = 730;
export const GATE = { x: 250, y: 92 };
export const MAX_PARTICLES = 700;

export const TIMELINE = {
  battle: 1.4,
  gate: 8.6,
  arrival: 9.2,
  charge: 11.2,
  barrage: 12.3,
  boom: 13.9,
  outro: 15.8,
  done: 19.5,
} as const;

export type Phase = "intro" | keyof typeof TIMELINE;

export const PHASES: Phase[] = [
  "intro",
  "battle",
  "gate",
  "arrival",
  "charge",
  "barrage",
  "boom",
  "outro",
  "done",
];

export type Speaker = "source" | "target";

export type Line = { from: number; to: number; speaker: Speaker; text: string };

export type Outcome = "running" | "success" | "failure";

export type EpisodeKind =
  | "coffee"
  | "deadlock"
  | "vacuum"
  | "conga"
  | "snail"
  | "fortress"
  | "rain"
  | "party";

export type Episode = { kind: EpisodeKind; start: number; duration: number; step: number };

export const SUBTITLES: Line[] = [
  { from: 1.6, to: 3.4, speaker: "source", text: "Dein Name? Gehört ab jetzt mir." },
  { from: 3.8, to: 5.6, speaker: "target", text: "Hey! Das ist mein Schema!" },
  { from: 5.9, to: 7.2, speaker: "target", text: "Fang! Ein NULL, ganz frisch!" },
  { from: 7.3, to: 8.5, speaker: "source", text: "Au. Das hat keinen Wert." },
  { from: 9.8, to: 11.6, speaker: "target", text: "Oh nein. Nein, nein, nein …" },
  { from: 11.9, to: 13.6, speaker: "source", text: "Zeit für ein kleines DROP." },
  { from: 16.4, to: 18.8, speaker: "source", text: "So geht ein Transfer." },
];

export type Glyph = "table" | "row" | "json" | "sql" | "bits";

export type ParticleKind =
  | "shot"
  | "letter"
  | "missile"
  | "laser"
  | "spark"
  | "debris"
  | "smoke"
  | "fire"
  | "hit"
  | "pop"
  | "ring"
  | "flake"
  | "null"
  | "splat"
  | "drop";

export type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  rot: number;
  spin: number;
  size: number;
  gravity: number;
  drag: number;
  color: string;
  text: string;
  glyph: Glyph;
  tx: number;
  ty: number;
  crit: boolean;
  trail: number[] | null;
};

export type Scene = {
  t: number;
  sourceName: string;
  targetName: string;
  launched: number;
  stolen: number;
  rows: number;
  hp: number;
  shake: number;
  flash: number;
  recoil: number;
  flinch: number;
  bonk: number;
  freeze: number;
  clock: number;
  outcome: Outcome;
  progress: number;
  table: string;
  tables: string[];
  popRows: number;
  popAt: number;
  calm: number;
  calmGoal: number;
  sourcePin: number | null;
  targetPin: number | null;
  throwAt: number;
  nextThrow: number;
  line: Line | null;
  nextLine: number;
  episode: Episode | null;
  nextEpisode: number;
  bag: EpisodeKind[];
  endedAt: number;
  liveRows: number;
  banter: number;
  lastEpisode: EpisodeKind | null;
  queue: Line[];
  vacuumPuff: number;
  rainNext: number;
  wall: number | null;
  wallHeight: number;
  destroyed: boolean;
  nextShot: number;
  nextLetter: number;
  nextLaser: number;
  nextMissile: number;
  nextSmoke: number;
  cannon: number;
  fired: Set<string>;
  particles: Particle[];
  peak: number;
  seed: number;
};

const HIT_WORDS = ["INSERT", "COPY", "Treffer", "+1 Zeile", "UPSERT", "COMMIT?"];
const GLYPHS: Glyph[] = ["table", "row", "json", "sql", "bits", "table", "row"];
const SHOT_COLORS = ["#5fd4ff", "#ffd166", "#ff8fab"];
const COSMETIC = new Set<ParticleKind>([
  "spark",
  "smoke",
  "fire",
  "flake",
  "ring",
  "debris",
  "drop",
  "splat",
]);

export function phaseAt(t: number): Phase {
  let phase: Phase = "intro";
  for (const key of PHASES) if (key !== "intro" && t >= TIMELINE[key]) phase = key;
  return phase;
}

export function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}

export function easeInOut(value: number) {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

export function shipPose(t: number) {
  if (t < TIMELINE.arrival) return null;
  const enter = easeInOut(clamp01((t - TIMELINE.arrival) / 2.2));
  const leave = easeInOut(clamp01((t - TIMELINE.outro - 0.9) / 1.8));
  const travel = enter * (1 - leave);
  return {
    x: GATE.x + (520 - GATE.x) * travel,
    y: GATE.y + (66 - GATE.y) * travel + Math.sin(t * 0.9) * 3 * travel,
    scale: 0.16 + 0.7 * travel,
    tilt: (1 - enter) * 0.08 - leave * 0.06,
    speed: clamp01((1 - enter) * enter * 4 + leave * (1 - leave) * 4),
  };
}

export function shipCannons(pose: NonNullable<ReturnType<typeof shipPose>>) {
  return [-210, 190].map((offset) => ({
    x: pose.x + offset * pose.scale,
    y: pose.y + 74 * pose.scale,
  }));
}

export function shipOrb(pose: NonNullable<ReturnType<typeof shipPose>>) {
  return { x: pose.x - 10 * pose.scale, y: pose.y + 96 * pose.scale };
}

export function gateOpen(t: number) {
  const first =
    easeOutCubic(clamp01((t - TIMELINE.gate) / 0.8)) *
    (1 - easeInOut(clamp01((t - TIMELINE.arrival - 2) / 0.7)));
  const second =
    easeOutCubic(clamp01((t - TIMELINE.outro - 0.5) / 0.6)) *
    (1 - easeInOut(clamp01((t - TIMELINE.outro - 2.7) / 0.6)));
  return Math.max(first, second);
}

export function nameSlots(name: string, centerX: number) {
  const width = 11;
  const start = centerX - (name.length * width) / 2 + width / 2;
  return Array.from(name, (_, index) => start + index * width);
}

export const LABEL_Y = GROUND - 212;

const DODGES = [
  { at: 2.5, x: 680 },
  { at: 3.9, x: 775 },
  { at: 5.1, x: 700 },
  { at: 6.6, x: 760 },
  { at: 7.9, x: 730 },
];
const DODGE_TIME = 0.42;
const DODGE_GAP = 1.6;
const PANIC_FROM = TIMELINE.arrival + 0.8;
const PANIC_TO = TIMELINE.boom - 0.15;
export const HOLD = TIMELINE.gate - 1.2;

export function hash01(value: number) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function window01(t: number, from: number, to: number, ramp: number) {
  return clamp01((t - from) / ramp) * clamp01((to - t) / ramp);
}

function dodgeAt(index: number) {
  if (index < DODGES.length) return DODGES[index];
  const step = index - DODGES.length + 1;
  return {
    at: DODGES[DODGES.length - 1].at + step * DODGE_GAP + hash01(index) * 0.6,
    x: 668 + hash01(index * 3.7) * 112,
  };
}

function dodgeIndex(clock: number) {
  const last = DODGES[DODGES.length - 1].at;
  let index =
    clock < last ? DODGES.length - 1 : DODGES.length - 1 + Math.floor((clock - last) / DODGE_GAP);
  while (index >= 0 && dodgeAt(index).at > clock) index--;
  while (dodgeAt(index + 1).at <= clock) index++;
  return index;
}

function dodgeMotion(clock: number) {
  const index = dodgeIndex(clock);
  const next = (clock - dodgeAt(index + 1).at) / DODGE_TIME;
  let squash = next > -0.3 ? Math.sin(((next + 0.3) / 0.3) * Math.PI * 0.5) * 0.6 : 0;
  if (index < 0) return { x: TARGET_X, hop: 0, squash };
  const dodge = dodgeAt(index);
  const from = index > 0 ? dodgeAt(index - 1).x : TARGET_X;
  const k = (clock - dodge.at) / DODGE_TIME;
  const x = from + (dodge.x - from) * easeInOut(clamp01(k));
  const hop = k < 1 ? Math.sin(Math.PI * clamp01(k)) * 48 : 0;
  if (k >= 1 && k < 1.4) squash = Math.max(squash, Math.sin(((k - 1) / 0.4) * Math.PI) * 0.7);
  return { x, hop, squash };
}

function settled(scene: Scene) {
  return easeInOut(clamp01((scene.t - HOLD - 0.02) / 0.9));
}

export function targetAt(scene: Scene, clock = scene.clock) {
  const t = scene.t;
  const motion = dodgeMotion(clock);
  const free = (1 - settled(scene)) * (1 - scene.calm);
  let x = TARGET_X + (motion.x - TARGET_X) * free;
  if (scene.targetPin !== null) x += (scene.targetPin - x) * scene.calm;
  let hop = motion.hop * free;
  const squash = motion.squash * free;
  const panic = window01(t, PANIC_FROM, PANIC_TO, 0.35);
  x += Math.sin((t - PANIC_FROM) * 5.2) * 70 * panic;
  hop += Math.abs(Math.sin((t - PANIC_FROM) * 10.4)) * 10 * panic;
  const throwing = window01(clock, scene.throwAt - 0.35, scene.throwAt + 0.1, 0.12);
  return { x, y: -hop, squash: hop > 1 ? -hop / 160 : squash, run: panic, throwing };
}

export function sourceAt(scene: Scene, clock = scene.clock) {
  const t = scene.t;
  const free = (1 - settled(scene)) * (1 - scene.calm);
  const battle = clamp01((clock - TIMELINE.battle) / 0.8) * free;
  let x = SOURCE_X + Math.sin((clock - TIMELINE.battle) * 1.3) * 24 * battle;
  if (scene.sourcePin !== null) x += (scene.sourcePin - x) * scene.calm;
  const strut = Math.abs(Math.sin((clock - TIMELINE.battle) * 2.6)) * 5 * battle;
  const jump = clamp01((t - TIMELINE.outro - 1.1) / 0.7);
  const victory = jump > 0 && jump < 1 ? Math.sin(Math.PI * jump) * 70 : 0;
  const crouch = window01(t, TIMELINE.outro + 0.9, TIMELINE.outro + 1.12, 0.1);
  const land = window01(t, TIMELINE.outro + 1.8, TIMELINE.outro + 2.1, 0.12);
  return {
    x,
    y: -strut - victory,
    squash: victory > 1 ? -victory / 220 : Math.max(crouch, land) * 0.5,
    lean: Math.cos((clock - TIMELINE.battle) * 1.3) * 0.05 * battle,
  };
}

export function muzzleAt(scene: Scene) {
  const source = sourceAt(scene);
  return { x: source.x + 106, y: GROUND - 80 + source.y };
}

export function random(scene: Scene) {
  scene.seed = (scene.seed + 0x6d2b79f5) | 0;
  let value = scene.seed;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function between(scene: Scene, min: number, max: number) {
  return min + random(scene) * (max - min);
}

export function pick<T>(scene: Scene, items: readonly T[]) {
  return items[Math.floor(random(scene) * items.length)];
}

export function createScene(sourceName: string, targetName: string, seed = 7): Scene {
  return {
    t: 0,
    sourceName,
    targetName,
    launched: 0,
    stolen: 0,
    rows: 0,
    hp: 1,
    shake: 0,
    flash: 0,
    recoil: 0,
    flinch: 0,
    bonk: 0,
    freeze: 0,
    clock: 0,
    outcome: "running",
    progress: 0,
    table: "",
    tables: [],
    popRows: 0,
    popAt: -1,
    calm: 0,
    calmGoal: 0,
    sourcePin: null,
    targetPin: null,
    throwAt: -10,
    nextThrow: 6.0,
    line: null,
    nextLine: 11,
    episode: null,
    nextEpisode: 14,
    bag: [],
    endedAt: 0,
    liveRows: 0,
    banter: 0,
    lastEpisode: null,
    queue: [],
    vacuumPuff: 0,
    rainNext: 0,
    wall: null,
    wallHeight: 0,
    destroyed: false,
    nextShot: TIMELINE.battle + 0.4,
    nextLetter: TIMELINE.battle + 0.8,
    nextLaser: TIMELINE.barrage,
    nextMissile: TIMELINE.barrage + 0.1,
    nextSmoke: TIMELINE.boom,
    cannon: 0,
    fired: new Set(),
    particles: [],
    peak: 0,
    seed,
  };
}

export function spawn(
  scene: Scene,
  partial: Partial<Particle> & Pick<Particle, "kind" | "x" | "y">,
) {
  if (COSMETIC.has(partial.kind) && scene.particles.length >= MAX_PARTICLES) return;
  scene.particles.push({
    vx: 0,
    vy: 0,
    age: 0,
    life: 1,
    rot: 0,
    spin: 0,
    size: 1,
    gravity: 0,
    drag: 0,
    color: "#fff",
    text: "",
    glyph: "table",
    tx: 0,
    ty: 0,
    crit: false,
    trail: null,
    ...partial,
  });
}

function ballistic(dx: number, dy: number, time: number, gravity: number) {
  return { vx: dx / time, vy: (dy - 0.5 * gravity * time * time) / time };
}

export function sparks(
  scene: Scene,
  x: number,
  y: number,
  count: number,
  power: number,
  color: string,
) {
  for (let index = 0; index < count; index++) {
    const angle = between(scene, -Math.PI, Math.PI);
    const speed = between(scene, 0.35, 1) * power;
    spawn(scene, {
      kind: "spark",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - power * 0.25,
      life: between(scene, 0.25, 0.6),
      gravity: 900,
      drag: 2,
      size: between(scene, 1.2, 2.6),
      color,
    });
  }
}

export function smoke(scene: Scene, x: number, y: number, size: number, life: number) {
  spawn(scene, {
    kind: "smoke",
    x: x + between(scene, -6, 6),
    y: y + between(scene, -6, 6),
    vx: between(scene, -25, 25),
    vy: between(scene, -60, -18),
    life,
    size,
    drag: 1.2,
    rot: between(scene, 0, Math.PI * 2),
    spin: between(scene, -0.6, 0.6),
  });
}

function fire(scene: Scene, x: number, y: number, size: number, spread: number) {
  const angle = between(scene, 0, Math.PI * 2);
  const speed = between(scene, 0.2, 1) * spread;
  spawn(scene, {
    kind: "fire",
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed * 0.7 - spread * 0.3,
    life: between(scene, 0.35, 0.8),
    size,
    drag: 3.5,
  });
}

export function impact(scene: Scene, x: number, y: number, crit: boolean, damage: number) {
  spawn(scene, { kind: "hit", x, y, life: crit ? 0.4 : 0.28, crit });
  sparks(scene, x, y, crit ? 12 : 6, crit ? 480 : 320, crit ? "#ff9a76" : "#fff2c2");
  scene.flinch = 1;
  scene.shake = Math.min(26, scene.shake + (crit ? 5 : 2.2));
  if (scene.outcome === "success") scene.hp = Math.max(0, scene.hp - damage);
}

function fireShot(scene: Scene) {
  const life = between(scene, 0.5, 0.78);
  const aim = targetAt(scene, random(scene) < 0.7 ? scene.clock + life : scene.clock);
  const walled = scene.wall !== null && scene.wallHeight > 30;
  const tx = walled ? (scene.wall ?? 0) + between(scene, -14, 4) : aim.x + between(scene, -36, 28);
  const ty = walled
    ? GROUND - between(scene, 16, scene.wallHeight - 8)
    : GROUND - between(scene, 40, 150) + aim.y;
  const gravity = 820;
  const muzzle = muzzleAt(scene);
  spawn(scene, {
    kind: "shot",
    x: muzzle.x,
    y: muzzle.y,
    ...ballistic(tx - muzzle.x, ty - muzzle.y, life, gravity),
    life,
    gravity,
    tx,
    ty,
    glyph: pick(scene, GLYPHS),
    color: pick(scene, SHOT_COLORS),
    spin: between(scene, -7, 7),
    size: between(scene, 0.8, 1.05),
    trail: [],
  });
  spawn(scene, {
    kind: "ring",
    x: muzzle.x + 6,
    y: muzzle.y,
    life: 0.2,
    size: 16,
    color: "#7fe3e0",
  });
  scene.recoil = 1;
}

function landShot(scene: Scene, shot: Particle) {
  if (scene.wall !== null && scene.wallHeight > 30 && shot.x > scene.wall - 40) {
    sparks(scene, shot.x, shot.y, 7, 300, "#fff2c2");
    spawn(scene, { kind: "hit", x: shot.x, y: shot.y, life: 0.25 });
    if (random(scene) < 0.3)
      spawn(scene, {
        kind: "pop",
        x: shot.x - 10,
        y: shot.y - 18,
        vy: -60,
        drag: 1.6,
        life: 0.8,
        text: pick(scene, ["Abgeprallt", "Index hält", "BLOCK"]),
      });
    scene.shake = Math.min(26, scene.shake + 1.2);
    return;
  }
  const body = targetAt(scene);
  if (Math.abs(shot.x - body.x) > 66 || shot.y < GROUND - 160 + body.y) {
    spawn(scene, {
      kind: "splat",
      x: shot.x,
      y: GROUND - 2,
      life: 1.4,
      size: between(scene, 0.8, 1.2),
      color: shot.color,
    });
    sparks(scene, shot.x, GROUND - 4, 5, 220, shot.color);
    spawn(scene, {
      kind: "pop",
      x: shot.x,
      y: GROUND - 30,
      vy: -60,
      drag: 1.6,
      life: 0.9,
      text: "Daneben!",
    });
    return;
  }
  impact(scene, shot.x, shot.y, false, 0.011);
  if (scene.clock - scene.popAt < 0.45) return;
  scene.popAt = scene.clock;
  const rows = scene.rows - scene.popRows;
  scene.popRows = scene.rows;
  spawn(scene, {
    kind: "pop",
    x: shot.x + between(scene, -10, 10),
    y: shot.y - 16,
    vy: -70,
    drag: 1.6,
    life: 0.9,
    text: rows > 0 ? `+${rows.toLocaleString("de-DE")}` : pick(scene, HIT_WORDS),
  });
}

function launchLetter(scene: Scene) {
  const index = scene.launched++;
  const body = targetAt(scene);
  const from = nameSlots(scene.targetName, body.x)[index];
  const life = 1.05;
  spawn(scene, {
    kind: "letter",
    x: from,
    y: LABEL_Y + body.y,
    vy: LABEL_Y + body.y,
    life,
    tx: from,
    ty: index,
    text: scene.targetName[index],
    spin: between(scene, 4, 8) * (random(scene) < 0.5 ? -1 : 1),
    trail: [],
  });
  sparks(scene, from, LABEL_Y, 4, 140, "#bdf5ff");
}

function returnLetter(scene: Scene) {
  const index = --scene.stolen;
  const body = sourceAt(scene);
  const from = nameSlots(scene.targetName, body.x)[index];
  spawn(scene, {
    kind: "letter",
    x: from,
    y: LABEL_Y + body.y,
    vy: LABEL_Y + body.y,
    life: 1.05,
    tx: from,
    ty: index,
    crit: true,
    text: scene.targetName[index],
    spin: between(scene, 4, 8),
    trail: [],
  });
}

function fireLaser(scene: Scene) {
  const pose = shipPose(scene.t);
  if (!pose) return;
  const cannon = shipCannons(pose)[scene.cannon++ % 2];
  const body = targetAt(scene);
  const tx = body.x + between(scene, -42, 42);
  const ty = GROUND - between(scene, 20, 140) + body.y;
  spawn(scene, { kind: "laser", x: cannon.x, y: cannon.y, tx, ty, life: 0.16 });
  impact(scene, tx, ty, true, 0.035);
}

function fireMissile(scene: Scene) {
  const pose = shipPose(scene.t);
  if (!pose) return;
  const side = random(scene) < 0.5 ? -1 : 1;
  spawn(scene, {
    kind: "missile",
    x: pose.x + side * 260 * pose.scale,
    y: pose.y + 40 * pose.scale,
    vx: side * between(scene, 120, 260),
    vy: between(scene, -220, -100),
    life: 2.2,
    tx: TARGET_X + between(scene, -60, 60),
    ty: GROUND - between(scene, 30, 120),
    trail: [],
  });
}

function burst(scene: Scene, x: number, y: number) {
  impact(scene, x, y, true, 0.04);
  spawn(scene, { kind: "ring", x, y, life: 0.35, size: 60, color: "#ffd8a8" });
  for (let index = 0; index < 5; index++) fire(scene, x, y, between(scene, 14, 26), 120);
  for (let index = 0; index < 5; index++)
    smoke(scene, x, y, between(scene, 12, 24), between(scene, 0.8, 1.4));
}

export function explodeAt(scene: Scene, x: number, y: number, count: number) {
  spawn(scene, { kind: "ring", x, y, life: 0.4, size: 90, color: "#ffd8a8" });
  for (let index = 0; index < count; index++) {
    const angle = between(scene, -Math.PI * 0.9, -Math.PI * 0.1);
    const speed = between(scene, 260, 640);
    spawn(scene, {
      kind: "debris",
      x: x + between(scene, -30, 30),
      y: y + between(scene, -30, 30),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: between(scene, 1.6, 2.4),
      gravity: 1500,
      drag: 0.3,
      size: between(scene, 6, 12),
      rot: between(scene, 0, Math.PI * 2),
      spin: between(scene, -10, 10),
      color: pick(scene, ["#f6e7b0", "#e8d48a", "#c9b26a"]),
    });
  }
  for (let index = 0; index < 8; index++) smoke(scene, x, y, between(scene, 12, 22), 1.1);
  sparks(scene, x, y, 20, 600, "#ffe8b0");
  scene.shake = Math.min(26, scene.shake + 10);
  scene.freeze = Math.max(scene.freeze, 0.08);
}

function explode(scene: Scene) {
  scene.destroyed = true;
  scene.freeze = 0.16;
  scene.hp = 0;
  scene.flash = 1;
  scene.shake = 30;
  const x = TARGET_X;
  const y = GROUND - 70;
  for (let index = 0; index < 3; index++) {
    spawn(scene, {
      kind: "ring",
      x,
      y,
      life: 0.6 + index * 0.25,
      size: 240 + index * 130,
      color: index === 0 ? "#ffffff" : "#9fe8ff",
    });
  }
  for (let index = 0; index < 26; index++) {
    const angle = between(scene, -Math.PI * 0.95, -Math.PI * 0.05);
    const speed = between(scene, 380, 1000);
    spawn(scene, {
      kind: "debris",
      x: x + between(scene, -40, 40),
      y: y + between(scene, -50, 40),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: between(scene, 2.2, 3.6),
      gravity: 1500,
      drag: 0.3,
      size: between(scene, 6, 16),
      rot: between(scene, 0, Math.PI * 2),
      spin: between(scene, -12, 12),
      color: pick(scene, ["#ffb199", "#e98f78", "#c9705c", "#7a4a3e"]),
      trail: [],
    });
  }
  for (let index = 0; index < 30; index++) fire(scene, x, y, between(scene, 26, 60), 420);
  sparks(scene, x, y, 60, 1000, "#ffe8b0");
  for (let index = 0; index < 30; index++) {
    smoke(
      scene,
      x + between(scene, -90, 90),
      y + between(scene, -60, 40),
      between(scene, 26, 56),
      between(scene, 1.8, 3.2),
    );
  }
}

function updateParticles(scene: Scene, dt: number) {
  const list = scene.particles;
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const p = list[read];
    p.age += dt;
    if (p.trail) {
      p.trail.push(p.x, p.y);
      if (p.trail.length > 24) p.trail.splice(0, 2);
    }
    if (p.kind === "letter") {
      const k = clamp01(p.age / p.life);
      const home = p.crit ? targetAt(scene) : sourceAt(scene);
      const slot = nameSlots(scene.targetName, home.x)[p.ty];
      const eased = easeInOut(k);
      p.x = p.tx + (slot - p.tx) * eased;
      p.y = p.vy + (LABEL_Y + home.y - p.vy) * eased - Math.sin(Math.PI * k) * 120;
      p.rot += p.spin * dt;
      if (p.age >= p.life) {
        if (p.crit) scene.launched = Math.min(scene.launched, p.ty);
        else scene.stolen++;
        spawn(scene, { kind: "ring", x: p.x, y: p.y, life: 0.3, size: 14, color: "#bdf5ff" });
        continue;
      }
      list[write++] = p;
      continue;
    }
    if (p.kind === "null") {
      const head = sourceAt(scene);
      const k = clamp01(p.age / p.life);
      p.x = p.tx + (head.x - p.tx) * k;
      p.y = p.ty + (GROUND - 150 + head.y - p.ty) * k - Math.sin(Math.PI * k) * 170;
      p.rot += p.spin * dt;
      if (p.age >= p.life) {
        scene.bonk = 1;
        scene.shake = Math.min(26, scene.shake + 6);
        sparks(scene, p.x, p.y, 10, 380, "#fff2c2");
        spawn(scene, { kind: "hit", x: p.x, y: p.y, life: 0.35, crit: true });
        spawn(scene, {
          kind: "pop",
          x: p.x,
          y: p.y - 30,
          vy: -50,
          drag: 1.4,
          life: 1.1,
          text: "NULL!",
        });
        continue;
      }
      list[write++] = p;
      continue;
    }
    if (p.kind === "missile") {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const distance = Math.hypot(dx, dy) || 1;
      const steer = Math.min(1, p.age * 1.4) * 2600;
      p.vx += (dx / distance) * steer * dt;
      p.vy += (dy / distance) * steer * dt;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > 820) {
        p.vx *= 820 / speed;
        p.vy *= 820 / speed;
      }
      p.rot = Math.atan2(p.vy, p.vx);
      if (random(scene) < 0.6)
        smoke(scene, p.x, p.y, between(scene, 4, 8), between(scene, 0.4, 0.8));
      if (distance < 26 || p.age >= p.life) {
        burst(scene, p.x, p.y);
        continue;
      }
    }
    if (p.kind === "drop" && p.y >= p.ty) {
      sparks(scene, p.x, p.ty, p.crit ? 3 : 2, p.crit ? 220 : 120, p.color);
      continue;
    }
    p.vy += p.gravity * dt;
    if (p.drag) {
      const keep = Math.exp(-p.drag * dt);
      p.vx *= keep;
      p.vy *= keep;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    if (p.kind === "debris" && p.y > GROUND - 3 && p.vy > 0) {
      p.y = GROUND - 3;
      p.vy *= -0.3;
      p.vx *= 0.6;
      p.spin *= 0.5;
    }
    if (p.kind === "smoke") p.size += dt * 16;
    if (p.age >= p.life) {
      if (p.kind === "shot") landShot(scene, p);
      continue;
    }
    list[write++] = p;
  }
  list.length = write;
}

function throwNull(scene: Scene) {
  const body = targetAt(scene);
  scene.throwAt = scene.clock;
  spawn(scene, {
    kind: "null",
    x: body.x - 70,
    y: GROUND - 140 + body.y,
    tx: body.x - 70,
    ty: GROUND - 140 + body.y,
    life: 0.85,
    spin: -9,
    trail: [],
  });
}

export function lettersWanted(scene: Scene) {
  const letters = scene.targetName.length;
  if (scene.outcome === "success") return letters;
  if (scene.outcome === "failure") return 0;
  return Math.min(letters - 1, Math.floor(scene.progress * letters));
}

export function stepScene(scene: Scene, dt: number) {
  scene.clock += dt;
  if (scene.freeze > 0) {
    scene.freeze -= dt;
    scene.shake *= Math.exp(-dt * 3);
    return;
  }
  const holding = scene.outcome !== "success" && scene.t >= HOLD;
  if (!holding) scene.t += dt;
  const t = scene.t;
  const clock = scene.clock;
  scene.shake *= Math.exp(-dt * 7);
  scene.flash *= Math.exp(-dt * 3.5);
  scene.recoil *= Math.exp(-dt * 12);
  scene.flinch *= Math.exp(-dt * 9);
  scene.bonk = scene.outcome === "failure" ? 1 : scene.bonk * Math.exp(-dt * 2.2);
  scene.calm += (scene.calmGoal - scene.calm) * (1 - Math.exp(-dt * 3.2));
  if (scene.outcome !== "success") scene.hp = 1 - scene.progress * 0.6;

  const fighting = scene.outcome === "running" && scene.calmGoal < 0.5;
  if (fighting && clock >= scene.nextThrow) {
    throwNull(scene);
    scene.nextThrow = clock < 6.4 ? 6.5 : clock + between(scene, 28, 44);
  }
  if (t < TIMELINE.gate - 0.3 && (fighting || scene.outcome === "success")) {
    while (clock >= scene.nextShot) {
      fireShot(scene);
      scene.nextShot += between(scene, 0.16, 0.36);
    }
  } else {
    scene.nextShot = Math.max(scene.nextShot, clock);
  }
  const wanted = lettersWanted(scene);
  if (scene.launched < wanted && clock >= scene.nextLetter && clock >= TIMELINE.battle + 0.8) {
    launchLetter(scene);
    scene.nextLetter = clock + (wanted - scene.launched > 2 ? 0.3 : 0.55);
  }
  if (scene.outcome === "failure" && scene.stolen > 0 && clock >= scene.nextLetter) {
    returnLetter(scene);
    scene.nextLetter = clock + 0.16;
  }
  if (t >= TIMELINE.boom && !scene.fired.has("boom")) {
    scene.fired.add("boom");
    explode(scene);
  }

  const pose = shipPose(t);
  if (pose && t >= TIMELINE.charge && t < TIMELINE.boom) {
    const orb = shipOrb(pose);
    const count = Math.min(6, Math.ceil(dt * 140));
    for (let index = 0; index < count; index++) {
      const angle = between(scene, 0, Math.PI * 2);
      const radius = between(scene, 110, 220);
      const life = between(scene, 0.3, 0.5);
      spawn(scene, {
        kind: "flake",
        x: orb.x + Math.cos(angle) * radius,
        y: orb.y + Math.sin(angle) * radius,
        vx: (-Math.cos(angle) * radius) / life,
        vy: (-Math.sin(angle) * radius) / life,
        life,
        size: between(scene, 1, 2.4),
        color: random(scene) < 0.5 ? "#7fe3e0" : "#7fe3ff",
        trail: [],
      });
    }
    scene.shake = Math.max(scene.shake, 0.8 + clamp01((t - TIMELINE.charge) / 2.5) * 2.4);
  }
  if (t >= TIMELINE.barrage && t < TIMELINE.boom - 0.35) {
    while (t >= scene.nextLaser) {
      fireLaser(scene);
      scene.nextLaser += between(scene, 0.1, 0.2);
    }
    while (t >= scene.nextMissile) {
      fireMissile(scene);
      scene.nextMissile += between(scene, 0.18, 0.32);
    }
  }
  if (scene.destroyed && t < TIMELINE.done) {
    while (t >= scene.nextSmoke) {
      smoke(
        scene,
        TARGET_X + between(scene, -30, 30),
        GROUND - 36,
        between(scene, 9, 16),
        between(scene, 1.4, 2.2),
      );
      scene.nextSmoke += 0.1;
    }
  }

  updateParticles(scene, dt);
  if (scene.particles.length > scene.peak) scene.peak = scene.particles.length;
}

export function activeLine(scene: Scene) {
  for (const entry of SUBTITLES) {
    const now = entry.from >= TIMELINE.gate ? scene.t : scene.clock;
    if (now >= entry.from && now <= entry.to) return { line: entry, now };
  }
  const line = scene.line;
  if (line && scene.clock >= line.from && scene.clock <= line.to) return { line, now: scene.clock };
  return null;
}
