export const STAGE_W = 960;
export const STAGE_H = 540;
export const GROUND = 430;
export const HORIZON = 318;
export const SOURCE_X = 230;
export const TARGET_X = 730;
export const RIFT = { x: 250, y: 96 };
export const MAX_PARTICLES = 700;

export const TIMELINE = {
  battle: 1.4,
  rift: 8.6,
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
  "rift",
  "arrival",
  "charge",
  "barrage",
  "boom",
  "outro",
  "done",
];

export type Speaker = "source" | "target" | "ship" | "system";

export const LOG: { from: number; to: number; speaker: Speaker; text: string }[] = [
  { from: 1.6, to: 4.6, speaker: "source", text: "Übernehme Bezeichner {target}" },
  { from: 4.2, to: 7.6, speaker: "target", text: "Warnung: Schema-Integrität sinkt" },
  { from: 8.8, to: 11.2, speaker: "system", text: "Hyperraum-Signatur erkannt" },
  { from: 10.2, to: 12.6, speaker: "ship", text: "Zielerfassung {target} bestätigt" },
  { from: 11.6, to: 13.9, speaker: "ship", text: "Hauptgeschütz lädt" },
  { from: 14.4, to: 16.4, speaker: "target", text: "Verbindung verloren" },
  {
    from: 16.4,
    to: 19.4,
    speaker: "system",
    text: "Transfer abgeschlossen · {source} führt jetzt {target}",
  },
];

export type Glyph = "table" | "row" | "json" | "key";

export type ParticleKind =
  | "shot"
  | "letter"
  | "missile"
  | "laser"
  | "spark"
  | "ember"
  | "debris"
  | "smoke"
  | "fire"
  | "dust"
  | "hit"
  | "pop"
  | "ring"
  | "flake";

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

const GLYPHS: Glyph[] = ["table", "row", "json", "key", "table", "row"];
const SHOT_COLORS = ["#7fd8ff", "#9ff0ff", "#b7c8ff"];
const COSMETIC = new Set<ParticleKind>([
  "spark",
  "ember",
  "smoke",
  "fire",
  "dust",
  "flake",
  "ring",
  "debris",
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
    x: RIFT.x + (520 - RIFT.x) * travel,
    y: RIFT.y + (70 - RIFT.y) * travel + Math.sin(t * 0.9) * 2 * travel,
    scale: 0.14 + 0.72 * travel,
    tilt: (1 - enter) * 0.06 - leave * 0.05,
    speed: clamp01((1 - enter) * enter * 4 + leave * (1 - leave) * 4),
  };
}

export function shipCannons(pose: NonNullable<ReturnType<typeof shipPose>>) {
  return [-210, 190].map((offset) => ({
    x: pose.x + offset * pose.scale,
    y: pose.y + 70 * pose.scale,
  }));
}

export function shipOrb(pose: NonNullable<ReturnType<typeof shipPose>>) {
  return { x: pose.x - 10 * pose.scale, y: pose.y + 92 * pose.scale };
}

export function riftOpen(t: number) {
  const first =
    easeOutCubic(clamp01((t - TIMELINE.rift) / 0.8)) *
    (1 - easeInOut(clamp01((t - TIMELINE.arrival - 2) / 0.7)));
  const second =
    easeOutCubic(clamp01((t - TIMELINE.outro - 0.5) / 0.6)) *
    (1 - easeInOut(clamp01((t - TIMELINE.outro - 2.7) / 0.6)));
  return Math.max(first, second);
}

export function nameSlots(name: string, centerX: number) {
  const width = 10;
  const start = centerX - (name.length * width) / 2 + width / 2;
  return Array.from(name, (_, index) => start + index * width);
}

export const LABEL_Y = GROUND - 232;
export const MUZZLE = { x: SOURCE_X + 8, y: GROUND - 196 };

function random(scene: Scene) {
  scene.seed = (scene.seed + 0x6d2b79f5) | 0;
  let value = scene.seed;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function between(scene: Scene, min: number, max: number) {
  return min + random(scene) * (max - min);
}

function pick<T>(scene: Scene, items: readonly T[]) {
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

function spawn(scene: Scene, partial: Partial<Particle> & Pick<Particle, "kind" | "x" | "y">) {
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

function sparks(scene: Scene, x: number, y: number, count: number, power: number, color: string) {
  for (let index = 0; index < count; index++) {
    const angle = between(scene, -Math.PI, Math.PI);
    const speed = between(scene, 0.35, 1) * power;
    spawn(scene, {
      kind: "spark",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - power * 0.25,
      life: between(scene, 0.2, 0.5),
      gravity: 1100,
      drag: 2,
      size: between(scene, 0.8, 1.8),
      color,
    });
  }
}

function embers(scene: Scene, x: number, y: number, count: number, power: number) {
  for (let index = 0; index < count; index++) {
    const angle = between(scene, -Math.PI * 0.95, -Math.PI * 0.05);
    const speed = between(scene, 0.3, 1) * power;
    spawn(scene, {
      kind: "ember",
      x: x + between(scene, -20, 20),
      y: y + between(scene, -20, 20),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: between(scene, 0.8, 2.2),
      gravity: 260,
      drag: 1.4,
      size: between(scene, 1, 2.2),
      trail: [],
    });
  }
}

function smoke(scene: Scene, x: number, y: number, size: number, life: number) {
  spawn(scene, {
    kind: "smoke",
    x: x + between(scene, -6, 6),
    y: y + between(scene, -6, 6),
    vx: between(scene, -20, 20),
    vy: between(scene, -55, -16),
    life,
    size,
    drag: 1.1,
    rot: between(scene, 0, Math.PI * 2),
    spin: between(scene, -0.5, 0.5),
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
    life: between(scene, 0.35, 0.9),
    size,
    drag: 3.2,
  });
}

function impact(scene: Scene, x: number, y: number, crit: boolean, damage: number) {
  spawn(scene, { kind: "hit", x, y, life: crit ? 0.4 : 0.28, crit });
  sparks(scene, x, y, crit ? 14 : 7, crit ? 520 : 340, crit ? "#ffb27a" : "#d8f4ff");
  scene.flinch = 1;
  scene.shake = Math.min(24, scene.shake + (crit ? 4.5 : 1.8));
  scene.hp = Math.max(0, scene.hp - damage);
}

function fireShot(scene: Scene) {
  const tx = TARGET_X + between(scene, -34, 30);
  const ty = GROUND - between(scene, 50, 170);
  const life = between(scene, 0.45, 0.7);
  const gravity = 520;
  spawn(scene, {
    kind: "shot",
    x: MUZZLE.x,
    y: MUZZLE.y,
    ...ballistic(tx - MUZZLE.x, ty - MUZZLE.y, life, gravity),
    life,
    gravity,
    tx,
    ty,
    glyph: pick(scene, GLYPHS),
    color: pick(scene, SHOT_COLORS),
    spin: between(scene, -3, 3),
    size: between(scene, 0.85, 1.05),
    trail: [],
  });
  spawn(scene, { kind: "ring", x: MUZZLE.x, y: MUZZLE.y, life: 0.18, size: 14, color: "#9fe6ff" });
  scene.recoil = 1;
}

function landShot(scene: Scene, shot: Particle) {
  const rows = Math.round(between(scene, 6, 42)) * 100;
  scene.rows += rows;
  impact(scene, shot.x, shot.y, false, 0.011);
  spawn(scene, {
    kind: "pop",
    x: shot.x + between(scene, -10, 10),
    y: shot.y - 16,
    vy: -60,
    drag: 1.6,
    life: 0.9,
    text: `+${rows.toLocaleString("de-DE")}`,
  });
}

function launchLetter(scene: Scene) {
  const index = scene.launched++;
  const from = nameSlots(scene.targetName, TARGET_X)[index];
  const to = nameSlots(scene.targetName, SOURCE_X)[index];
  const life = 1.1;
  const gravity = 520;
  spawn(scene, {
    kind: "letter",
    x: from,
    y: LABEL_Y,
    ...ballistic(to - from, 0, life, gravity),
    life,
    gravity,
    text: scene.targetName[index],
    spin: between(scene, 2, 5) * (random(scene) < 0.5 ? -1 : 1),
    trail: [],
  });
  sparks(scene, from, LABEL_Y, 5, 140, "#ffd59a");
}

function fireLaser(scene: Scene) {
  const pose = shipPose(scene.t);
  if (!pose) return;
  const cannon = shipCannons(pose)[scene.cannon++ % 2];
  const tx = TARGET_X + between(scene, -40, 40);
  const ty = GROUND - between(scene, 20, 160);
  spawn(scene, { kind: "laser", x: cannon.x, y: cannon.y, tx, ty, life: 0.16 });
  impact(scene, tx, ty, true, 0.035);
  scene.rows += 25_000;
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
    vy: between(scene, -200, -90),
    life: 2.2,
    tx: TARGET_X + between(scene, -40, 40),
    ty: GROUND - between(scene, 30, 140),
    trail: [],
  });
}

function burst(scene: Scene, x: number, y: number) {
  impact(scene, x, y, true, 0.04);
  spawn(scene, { kind: "ring", x, y, life: 0.3, size: 54, color: "#ffd2a0" });
  for (let index = 0; index < 5; index++) fire(scene, x, y, between(scene, 14, 26), 110);
  for (let index = 0; index < 4; index++)
    smoke(scene, x, y, between(scene, 12, 22), between(scene, 1, 1.8));
  embers(scene, x, y, 5, 260);
  scene.rows += 60_000;
}

function explode(scene: Scene) {
  scene.destroyed = true;
  scene.hp = 0;
  scene.flash = 1;
  scene.shake = 28;
  const x = TARGET_X;
  const y = GROUND - 80;
  spawn(scene, { kind: "ring", x, y, life: 0.7, size: 420, color: "#fff4e0" });
  spawn(scene, { kind: "dust", x, y: GROUND, life: 1.8, size: 520 });
  for (let index = 0; index < 26; index++) {
    const angle = between(scene, -Math.PI * 0.95, -Math.PI * 0.05);
    const speed = between(scene, 380, 1000);
    spawn(scene, {
      kind: "debris",
      x: x + between(scene, -40, 40),
      y: y + between(scene, -60, 40),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: between(scene, 2.4, 3.8),
      gravity: 1500,
      drag: 0.3,
      size: between(scene, 4, 12),
      rot: between(scene, 0, Math.PI * 2),
      spin: between(scene, -12, 12),
      color: pick(scene, ["#6f7682", "#4c525d", "#8d949f", "#3a3f48"]),
      trail: [],
    });
  }
  for (let index = 0; index < 34; index++) fire(scene, x, y, between(scene, 28, 70), 420);
  sparks(scene, x, y, 50, 1000, "#ffe1b0");
  embers(scene, x, y, 40, 640);
  for (let index = 0; index < 30; index++) {
    smoke(
      scene,
      x + between(scene, -90, 90),
      y + between(scene, -70, 40),
      between(scene, 30, 64),
      between(scene, 2.2, 3.8),
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
      if (random(scene) < 0.6) smoke(scene, p.x, p.y, between(scene, 4, 8), between(scene, 0.5, 1));
      if (distance < 26 || p.age >= p.life) {
        burst(scene, p.x, p.y);
        continue;
      }
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
    if ((p.kind === "debris" || p.kind === "ember") && p.y > GROUND - 2 && p.vy > 0) {
      p.y = GROUND - 2;
      p.vy *= -0.28;
      p.vx *= 0.6;
      p.spin *= 0.5;
    }
    if (p.kind === "smoke") p.size += dt * 18;
    if (p.age >= p.life) {
      if (p.kind === "shot") landShot(scene, p);
      if (p.kind === "letter") {
        scene.stolen++;
        spawn(scene, { kind: "ring", x: p.x, y: p.y, life: 0.3, size: 14, color: "#9fe6ff" });
      }
      continue;
    }
    list[write++] = p;
  }
  list.length = write;
}

export function stepScene(scene: Scene, dt: number) {
  scene.t += dt;
  const t = scene.t;
  scene.shake *= Math.exp(-dt * 7);
  scene.flash *= Math.exp(-dt * 3.5);
  scene.recoil *= Math.exp(-dt * 12);
  scene.flinch *= Math.exp(-dt * 9);

  if (t < TIMELINE.rift - 0.3) {
    while (t >= scene.nextShot) {
      fireShot(scene);
      scene.nextShot += between(scene, 0.14, 0.32);
    }
  }
  const letters = scene.targetName.length;
  const letterGap = (TIMELINE.rift - TIMELINE.battle - 2) / Math.max(1, letters);
  while (scene.launched < letters && t >= scene.nextLetter) {
    launchLetter(scene);
    scene.nextLetter += letterGap;
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
        size: between(scene, 0.8, 2),
        color: random(scene) < 0.5 ? "#a8e4ff" : "#ffffff",
        trail: [],
      });
    }
    scene.shake = Math.max(scene.shake, 0.6 + clamp01((t - TIMELINE.charge) / 2.5) * 2.2);
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
        GROUND - 40,
        between(scene, 10, 18),
        between(scene, 1.8, 2.8),
      );
      scene.nextSmoke += 0.1;
    }
  }

  updateParticles(scene, dt);
  if (scene.particles.length > scene.peak) scene.peak = scene.particles.length;
}
