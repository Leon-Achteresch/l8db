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

export const SUBTITLES: { from: number; to: number; speaker: Speaker; text: string }[] = [
  { from: 1.6, to: 3.4, speaker: "source", text: "Dein Name? Gehört ab jetzt mir." },
  { from: 3.8, to: 5.8, speaker: "target", text: "Hey! Das ist mein Schema!" },
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

const GLYPHS: Glyph[] = ["table", "row", "json", "sql", "bits", "table", "row"];
const SHOT_COLORS = ["#5fd4ff", "#ffd166", "#ff8fab"];
const COSMETIC = new Set<ParticleKind>(["spark", "smoke", "fire", "flake", "ring", "debris"]);

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
export const MUZZLE = { x: SOURCE_X + 106, y: GROUND - 80 };

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
      life: between(scene, 0.25, 0.6),
      gravity: 900,
      drag: 2,
      size: between(scene, 1.2, 2.6),
      color,
    });
  }
}

function smoke(scene: Scene, x: number, y: number, size: number, life: number) {
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

function impact(scene: Scene, x: number, y: number, crit: boolean, damage: number) {
  spawn(scene, { kind: "hit", x, y, life: crit ? 0.4 : 0.28, crit });
  sparks(scene, x, y, crit ? 12 : 6, crit ? 480 : 320, crit ? "#ff9a76" : "#fff2c2");
  scene.flinch = 1;
  scene.shake = Math.min(26, scene.shake + (crit ? 5 : 2.2));
  scene.hp = Math.max(0, scene.hp - damage);
}

function fireShot(scene: Scene) {
  const tx = TARGET_X + between(scene, -36, 28);
  const ty = GROUND - between(scene, 40, 150);
  const life = between(scene, 0.5, 0.78);
  const gravity = 820;
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
    spin: between(scene, -7, 7),
    size: between(scene, 0.8, 1.05),
    trail: [],
  });
  spawn(scene, {
    kind: "ring",
    x: MUZZLE.x + 6,
    y: MUZZLE.y,
    life: 0.2,
    size: 16,
    color: "#7fe3e0",
  });
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
    vy: -70,
    drag: 1.6,
    life: 0.9,
    text: `+${rows.toLocaleString("de-DE")}`,
  });
}

function launchLetter(scene: Scene) {
  const index = scene.launched++;
  const from = nameSlots(scene.targetName, TARGET_X)[index];
  const to = nameSlots(scene.targetName, SOURCE_X)[index];
  const life = 1.05;
  const gravity = 600;
  spawn(scene, {
    kind: "letter",
    x: from,
    y: LABEL_Y,
    ...ballistic(to - from, 0, life, gravity),
    life,
    gravity,
    text: scene.targetName[index],
    spin: between(scene, 4, 8) * (random(scene) < 0.5 ? -1 : 1),
    trail: [],
  });
  sparks(scene, from, LABEL_Y, 4, 140, "#bdf5ff");
}

function fireLaser(scene: Scene) {
  const pose = shipPose(scene.t);
  if (!pose) return;
  const cannon = shipCannons(pose)[scene.cannon++ % 2];
  const tx = TARGET_X + between(scene, -42, 42);
  const ty = GROUND - between(scene, 20, 140);
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
    vy: between(scene, -220, -100),
    life: 2.2,
    tx: TARGET_X + between(scene, -40, 40),
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
  scene.rows += 60_000;
}

function explode(scene: Scene) {
  scene.destroyed = true;
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
      if (p.kind === "letter") {
        scene.stolen++;
        spawn(scene, {
          kind: "ring",
          x: p.x,
          y: p.y,
          life: 0.3,
          size: 14,
          color: "#bdf5ff",
        });
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

  if (t < TIMELINE.gate - 0.3) {
    while (t >= scene.nextShot) {
      fireShot(scene);
      scene.nextShot += between(scene, 0.16, 0.36);
    }
  }
  const letters = scene.targetName.length;
  const letterGap = (TIMELINE.gate - TIMELINE.battle - 2) / Math.max(1, letters);
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
