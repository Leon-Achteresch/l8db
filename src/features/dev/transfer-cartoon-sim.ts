export const STAGE_W = 960;
export const STAGE_H = 540;
export const GROUND = 430;
export const SOURCE_X = 210;
export const TARGET_X = 750;
export const PORTAL = { x: 190, y: 105 };
export const MAX_PARTICLES = 700;

export const TIMELINE = {
  battle: 1.2,
  portal: 8.6,
  arrival: 9.3,
  charge: 11,
  barrage: 12.1,
  boom: 13.7,
  outro: 15.6,
  done: 19,
} as const;

export type Phase = "intro" | keyof typeof TIMELINE;

export const PHASES: Phase[] = [
  "intro",
  "battle",
  "portal",
  "arrival",
  "charge",
  "barrage",
  "boom",
  "outro",
  "done",
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
  | "hit"
  | "pop"
  | "ring"
  | "say"
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
const SHOT_COLORS = ["#97ce4c", "#f2e94e", "#3fd0ff", "#ff7ad9", "#ff9f43"];
const BOOMS = ["POW!", "ZACK!", "BAM!", "KLONK!", "WUMMS!"];
const COSMETIC = new Set<ParticleKind>(["spark", "smoke", "flake", "ring", "debris"]);

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
  const enter = easeOutCubic(clamp01((t - TIMELINE.arrival) / 1.5));
  const leave = easeInOut(clamp01((t - TIMELINE.outro - 0.8) / 1.6));
  const travel = enter * (1 - leave);
  return {
    x: PORTAL.x + (610 - PORTAL.x) * travel,
    y: PORTAL.y + (116 - PORTAL.y) * travel + Math.sin(t * 2.1) * 4 * travel,
    scale: 0.1 + 0.68 * travel,
    tilt: (1 - enter) * -0.25 + leave * -0.2,
    speed: (1 - enter) * enter * 4 + leave * (1 - leave) * 4,
  };
}

export function shipCannons(pose: NonNullable<ReturnType<typeof shipPose>>) {
  return [-170, 150].map((offset) => ({
    x: pose.x + offset * pose.scale,
    y: pose.y + 62 * pose.scale,
  }));
}

export function shipOrb(pose: NonNullable<ReturnType<typeof shipPose>>) {
  return { x: pose.x - 10 * pose.scale, y: pose.y + 74 * pose.scale };
}

export function portalOpen(t: number) {
  const open = easeOutCubic(clamp01((t - TIMELINE.portal) / 0.7));
  const close = clamp01((t - TIMELINE.outro - 2.3) / 0.6);
  return open * (1 - close * close);
}

export function nameSlots(name: string, centerX: number) {
  const width = 13;
  const start = centerX - (name.length * width) / 2 + width / 2;
  return Array.from(name, (_, index) => start + index * width);
}

export const LABEL_Y = GROUND - 205;
export const MUZZLE = { x: SOURCE_X + 118, y: GROUND - 82 };

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
    nextShot: TIMELINE.battle + 0.3,
    nextLetter: TIMELINE.battle + 0.6,
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
      size: between(scene, 2, 4.5),
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
    vy: between(scene, -70, -20),
    life,
    size,
    drag: 1.2,
    rot: between(scene, 0, Math.PI * 2),
    spin: between(scene, -1, 1),
  });
}

function say(scene: Scene, x: number, y: number, text: string, life = 1.9) {
  spawn(scene, { kind: "say", x, y, text, life });
}

function impact(scene: Scene, x: number, y: number, crit: boolean, damage: number) {
  spawn(scene, { kind: "hit", x, y, life: crit ? 0.45 : 0.32, crit });
  sparks(scene, x, y, crit ? 14 : 7, crit ? 520 : 360, crit ? "#ff5a5a" : "#fff6a8");
  scene.flinch = 1;
  scene.shake = Math.min(30, scene.shake + (crit ? 7 : 3.5));
  scene.hp = Math.max(0, scene.hp - damage);
}

function fireShot(scene: Scene) {
  const tx = TARGET_X + between(scene, -38, 30);
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
    spin: between(scene, -9, 9),
    size: between(scene, 0.85, 1.15),
    trail: [],
  });
  spawn(scene, {
    kind: "ring",
    x: MUZZLE.x + 8,
    y: MUZZLE.y,
    life: 0.22,
    size: 18,
    color: "#97ce4c",
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
    y: shot.y - 18,
    vy: -95,
    drag: 1.6,
    life: 0.9,
    text: `+${rows.toLocaleString("de-DE")} Zeilen`,
    size: 0.8,
  });
  if (random(scene) < 0.22) {
    spawn(scene, {
      kind: "pop",
      x: shot.x + between(scene, -50, 20),
      y: shot.y - between(scene, 50, 80),
      life: 0.6,
      text: pick(scene, BOOMS),
      size: 1.25,
      crit: true,
      rot: between(scene, -0.25, 0.25),
    });
  }
}

function launchLetter(scene: Scene) {
  const index = scene.launched++;
  const from = nameSlots(scene.targetName, TARGET_X)[index];
  const to = nameSlots(scene.targetName, SOURCE_X)[index];
  const life = 0.95;
  const gravity = 700;
  spawn(scene, {
    kind: "letter",
    x: from,
    y: LABEL_Y,
    ...ballistic(to - from, 0, life, gravity),
    life,
    gravity,
    text: scene.targetName[index],
    spin: between(scene, 7, 13) * (random(scene) < 0.5 ? -1 : 1),
    trail: [],
  });
  sparks(scene, from, LABEL_Y, 4, 160, "#f2e94e");
}

function fireLaser(scene: Scene) {
  const pose = shipPose(scene.t);
  if (!pose) return;
  const cannon = shipCannons(pose)[scene.cannon++ % 2];
  const tx = TARGET_X + between(scene, -45, 45);
  const ty = GROUND - between(scene, 20, 140);
  spawn(scene, { kind: "laser", x: cannon.x, y: cannon.y, tx, ty, life: 0.16, color: "#ff4d6d" });
  impact(scene, tx, ty, true, 0.035);
  scene.rows += 25_000;
  if (random(scene) < 0.45) {
    spawn(scene, {
      kind: "pop",
      x: tx,
      y: ty - 36,
      vy: -70,
      drag: 1.4,
      life: 0.7,
      text: "CRIT",
      size: 0.95,
      crit: true,
    });
  }
}

function fireMissile(scene: Scene) {
  const pose = shipPose(scene.t);
  if (!pose) return;
  const side = random(scene) < 0.5 ? -1 : 1;
  spawn(scene, {
    kind: "missile",
    x: pose.x + side * 230 * pose.scale,
    y: pose.y + 20 * pose.scale,
    vx: side * between(scene, 120, 260),
    vy: between(scene, -260, -120),
    life: 2.2,
    tx: TARGET_X + between(scene, -40, 40),
    ty: GROUND - between(scene, 30, 120),
    trail: [],
  });
}

function burst(scene: Scene, x: number, y: number) {
  impact(scene, x, y, true, 0.04);
  spawn(scene, { kind: "ring", x, y, life: 0.4, size: 70, color: "#ffb347" });
  for (let index = 0; index < 6; index++)
    smoke(scene, x, y, between(scene, 16, 30), between(scene, 0.8, 1.4));
  spawn(scene, {
    kind: "pop",
    x: x + between(scene, -30, 30),
    y: y - 50,
    life: 0.7,
    text: pick(scene, ["KRAWUMM!", "BOOM!", "WAMM!"]),
    size: 1.4,
    crit: true,
    rot: between(scene, -0.3, 0.3),
  });
  scene.rows += 60_000;
}

function explode(scene: Scene) {
  scene.destroyed = true;
  scene.hp = 0;
  scene.flash = 1;
  scene.shake = 34;
  const x = TARGET_X;
  const y = GROUND - 70;
  for (let index = 0; index < 3; index++) {
    spawn(scene, {
      kind: "ring",
      x,
      y,
      life: 0.6 + index * 0.25,
      size: 240 + index * 120,
      color: index === 0 ? "#ffffff" : "#97ce4c",
    });
  }
  for (let index = 0; index < 28; index++) {
    const angle = between(scene, -Math.PI * 0.95, -Math.PI * 0.05);
    const speed = between(scene, 380, 1050);
    spawn(scene, {
      kind: "debris",
      x: x + between(scene, -40, 40),
      y: y + between(scene, -50, 40),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: between(scene, 2.2, 3.6),
      gravity: 1500,
      drag: 0.3,
      size: between(scene, 8, 22),
      rot: between(scene, 0, Math.PI * 2),
      spin: between(scene, -14, 14),
      color: pick(scene, ["#5aa9e6", "#3d7fc0", "#9fd2ff", "#f2e94e"]),
      glyph: pick(scene, GLYPHS),
      trail: [],
    });
  }
  sparks(scene, x, y, 70, 1100, "#fff6a8");
  for (let index = 0; index < 34; index++)
    smoke(
      scene,
      x + between(scene, -90, 90),
      y + between(scene, -60, 40),
      between(scene, 30, 64),
      between(scene, 1.8, 3.2),
    );
  spawn(scene, {
    kind: "pop",
    x: x - 150,
    y: y - 130,
    life: 2.6,
    text: "DROP DATABASE!",
    size: 1.6,
    crit: true,
    rot: -0.08,
  });
}

function event(scene: Scene, key: string, at: number, run: () => void) {
  if (scene.t >= at && !scene.fired.has(key)) {
    scene.fired.add(key);
    run();
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
      if (random(scene) < 0.7)
        smoke(scene, p.x, p.y, between(scene, 6, 11), between(scene, 0.4, 0.8));
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
    if (p.kind === "debris" && p.y > GROUND - 4 && p.vy > 0) {
      p.y = GROUND - 4;
      p.vy *= -0.32;
      p.vx *= 0.6;
      p.spin *= 0.5;
    }
    if (p.kind === "smoke") p.size += dt * 18;
    if (p.age >= p.life) {
      if (p.kind === "shot") landShot(scene, p);
      if (p.kind === "letter") {
        scene.stolen++;
        spawn(scene, { kind: "ring", x: p.x, y: p.y, life: 0.25, size: 16, color: "#f2e94e" });
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
  scene.flash *= Math.exp(-dt * 4);
  scene.recoil *= Math.exp(-dt * 12);
  scene.flinch *= Math.exp(-dt * 9);

  if (t < TIMELINE.portal - 0.3) {
    while (t >= scene.nextShot) {
      fireShot(scene);
      scene.nextShot += between(scene, 0.14, 0.34);
    }
  }
  const letters = scene.targetName.length;
  const letterGap = (TIMELINE.portal - TIMELINE.battle - 1.8) / Math.max(1, letters);
  while (scene.launched < letters && t >= scene.nextLetter) {
    launchLetter(scene);
    scene.nextLetter += letterGap;
  }

  event(scene, "taunt", TIMELINE.battle + 0.2, () =>
    say(scene, SOURCE_X + 40, GROUND - 250, "Dein Name? Meiner.", 1.6),
  );
  event(scene, "whine", TIMELINE.battle + 2.6, () =>
    say(scene, TARGET_X - 30, GROUND - 250, "H-hey! Das ist mein Schema!", 1.8),
  );
  event(scene, "portal", TIMELINE.portal, () =>
    spawn(scene, {
      kind: "ring",
      x: PORTAL.x,
      y: PORTAL.y,
      life: 0.5,
      size: 120,
      color: "#97ce4c",
    }),
  );
  event(scene, "geez", TIMELINE.arrival + 0.5, () =>
    say(scene, TARGET_X - 20, GROUND - 260, "Oh geez … oh nein …", 2),
  );
  event(scene, "wubba", TIMELINE.arrival + 1.4, () =>
    say(scene, SOURCE_X + 110, GROUND - 175, "Wubba lubba DROP DROP!", 2),
  );
  event(scene, "boom", TIMELINE.boom, () => explode(scene));
  event(scene, "mine", TIMELINE.outro + 0.4, () =>
    say(scene, SOURCE_X + 40, GROUND - 250, "Und DAS ist ein Transfer.", 2.4),
  );

  const pose = shipPose(t);
  if (pose && t >= TIMELINE.charge && t < TIMELINE.boom) {
    const orb = shipOrb(pose);
    const count = Math.min(6, Math.ceil(dt * 160));
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
        size: between(scene, 1.5, 3.5),
        color: random(scene) < 0.5 ? "#97ce4c" : "#3fd0ff",
        trail: [],
      });
    }
    scene.shake = Math.max(scene.shake, 1.2 + clamp01((t - TIMELINE.charge) / 2.5) * 3);
  }
  if (t >= TIMELINE.barrage && t < TIMELINE.boom - 0.35) {
    while (t >= scene.nextLaser) {
      fireLaser(scene);
      scene.nextLaser += between(scene, 0.09, 0.18);
    }
    while (t >= scene.nextMissile) {
      fireMissile(scene);
      scene.nextMissile += between(scene, 0.16, 0.3);
    }
  }
  if (scene.destroyed && t < TIMELINE.done) {
    while (t >= scene.nextSmoke) {
      smoke(
        scene,
        TARGET_X + between(scene, -30, 30),
        GROUND - 40,
        between(scene, 10, 18),
        between(scene, 1.2, 2),
      );
      scene.nextSmoke += 0.09;
    }
  }

  updateParticles(scene, dt);
  if (scene.particles.length > scene.peak) scene.peak = scene.particles.length;
}
