import {
  clamp01,
  easeInOut,
  easeOutCubic,
  GROUND,
  HORIZON,
  LABEL_Y,
  LOG,
  MUZZLE,
  nameSlots,
  type Particle,
  RIFT,
  riftOpen,
  type Scene,
  SOURCE_X,
  type Speaker,
  STAGE_H,
  STAGE_W,
  shipOrb,
  shipPose,
  TARGET_X,
  TIMELINE,
} from "./transfer-cinematic-sim";

type Ctx = CanvasRenderingContext2D;
type Pose = NonNullable<ReturnType<typeof shipPose>>;
type Camera = { zoom: number; x: number; y: number };
type Tower = {
  x: number;
  warm: boolean;
  recoil: number;
  flinch: number;
  tremble: number;
  look: number;
  led: string;
  damage: number;
  t: number;
};

const UI = '"Inter", "SF Pro Text", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const COOL = "#7fd8ff";
const WARM = "#ffb547";
const ALARM = "#ff4a3a";
const SUN = { x: 700, y: HORIZON - 16 };
const TAGS: Record<Speaker, { label: string; color: string }> = {
  source: { label: "QUELLE", color: COOL },
  target: { label: "ZIEL", color: WARM },
  ship: { label: "FLAGGSCHIFF", color: "#ff7a6b" },
  system: { label: "SYSTEM", color: "#e8ecf4" },
};

const SHOTS: [number, number, number, number][] = [
  [0, 1.22, 480, 300],
  [TIMELINE.battle, 1, 480, 270],
  [TIMELINE.rift - 0.2, 1.04, 480, 280],
  [TIMELINE.arrival + 0.4, 0.94, 460, 236],
  [TIMELINE.charge, 0.94, 480, 232],
  [TIMELINE.barrage, 1.03, 580, 262],
  [TIMELINE.boom - 0.1, 1.1, 650, 296],
  [TIMELINE.boom + 0.15, 0.98, 610, 280],
  [TIMELINE.outro, 1, 520, 270],
  [TIMELINE.outro + 1.6, 1.1, 360, 290],
  [TIMELINE.done + 2, 1.1, 360, 290],
];

const PLINTH = 14;
const PLATTER = 44;
const GAP = 8;
const RX = 52;
const RY = 13;
const TOP = -180;

function hash(value: number) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

function camera(t: number): Camera {
  for (let index = 1; index < SHOTS.length; index++) {
    const [to, zoom, x, y] = SHOTS[index];
    if (t <= to) {
      const [from, z0, x0, y0] = SHOTS[index - 1];
      const k = easeInOut(clamp01((t - from) / (to - from)));
      return { zoom: lerp(z0, zoom, k), x: lerp(x0, x, k), y: lerp(y0, y, k) };
    }
  }
  const [, zoom, x, y] = SHOTS[SHOTS.length - 1];
  return { zoom, x, y };
}

function enterLayer(ctx: Ctx, cam: Camera, depth: number) {
  const zoom = 1 + (cam.zoom - 1) * depth;
  ctx.save();
  ctx.translate(STAGE_W / 2, STAGE_H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(
    -(STAGE_W / 2 + (cam.x - STAGE_W / 2) * depth),
    -(STAGE_H / 2 + (cam.y - STAGE_H / 2) * depth),
  );
}

function glow(ctx: Ctx, x: number, y: number, radius: number, color: string, alpha: number) {
  if (radius <= 0.5 || alpha <= 0.01) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

function nightAmount(t: number) {
  return clamp01((t - TIMELINE.arrival) / 1.6) * (1 - clamp01((t - TIMELINE.outro - 1.4) / 1.6));
}

function ridge(seed: number, amplitude: number, base: number, step: number) {
  const points: number[] = [];
  for (let x = -500; x <= 1460; x += step) {
    const noise =
      Math.sin(x * 0.004 + seed) * 0.5 +
      Math.sin(x * 0.011 + seed * 2.1) * 0.3 +
      (hash(Math.floor(x / step) + seed * 100) - 0.5) * 0.4;
    points.push(x, base - amplitude * (0.55 + noise * 0.6));
  }
  return points;
}

const RIDGES = [
  { points: ridge(1, 110, HORIZON, 24), color: "#a0697a", haze: 0.55 },
  { points: ridge(4, 80, HORIZON + 6, 18), color: "#5e4560", haze: 0.35 },
];
const HILLS = ridge(9, 70, GROUND - 22, 14);

const STARS = Array.from({ length: 120 }, (_, index) => ({
  x: -300 + hash(index + 1) * 1560,
  y: -200 + hash(index + 101) * 400,
  r: 0.4 + hash(index + 201) * 1,
  phase: hash(index + 301) * 6,
}));

const BUILDINGS = Array.from({ length: 34 }, (_, index) => {
  const w = 22 + hash(index + 11) * 46;
  return {
    x: -420 + index * 56 + hash(index + 21) * 20,
    w,
    h: 10 + hash(index + 31) * 40 + (index % 7 === 3 ? 30 : 0),
    beacon: hash(index + 41) > 0.6,
  };
});

let grain: CanvasPattern | null | undefined;

function grainPattern(ctx: Ctx) {
  if (grain !== undefined) return grain;
  grain = null;
  if (typeof document === "undefined") return grain;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const noise = canvas.getContext("2d");
  if (!noise) return grain;
  const image = noise.createImageData(160, 160);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.random() * 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  noise.putImageData(image, 0, 0);
  grain = ctx.createPattern(canvas, "repeat");
  return grain;
}

function drawSky(ctx: Ctx, t: number) {
  const sky = ctx.createLinearGradient(0, -260, 0, HORIZON);
  sky.addColorStop(0, "#050813");
  sky.addColorStop(0.42, "#141d3a");
  sky.addColorStop(0.72, "#4a3a5e");
  sky.addColorStop(0.9, "#c7706a");
  sky.addColorStop(1, "#f5a565");
  ctx.fillStyle = sky;
  ctx.fillRect(-500, -400, STAGE_W + 1000, HORIZON + 400);
  ctx.fillStyle = "#f5a565";
  ctx.fillRect(-500, HORIZON, STAGE_W + 1000, 400);
  for (const star of STARS) {
    const fade = clamp01((HORIZON - 120 - star.y) / 220);
    if (fade <= 0) continue;
    ctx.globalAlpha = fade * (0.35 + 0.4 * Math.abs(Math.sin(t * 0.8 + star.phase)));
    ctx.fillStyle = "#e8eeff";
    ctx.fillRect(star.x, star.y, star.r, star.r);
  }
  ctx.globalAlpha = 1;
  glow(ctx, SUN.x, SUN.y, 420, "rgba(255,170,110,0.55)", 1);
  glow(ctx, SUN.x, SUN.y, 90, "rgba(255,230,190,0.9)", 1);
  ctx.beginPath();
  ctx.arc(SUN.x, SUN.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = "#fff4dc";
  ctx.fill();
  for (let index = 0; index < 7; index++) {
    const y = HORIZON - 40 - index * 22 - hash(index + 7) * 14;
    const x = -200 + hash(index + 17) * 1100 + ((t * 4) % 200);
    const w = 160 + hash(index + 27) * 260;
    const band = ctx.createLinearGradient(x - w, 0, x + w, 0);
    band.addColorStop(0, "rgba(255,160,120,0)");
    band.addColorStop(
      0.5,
      `rgba(255,${150 + index * 6},${120 + index * 10},${0.22 - index * 0.02})`,
    );
    band.addColorStop(1, "rgba(255,160,120,0)");
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.ellipse(x, y, w, 3 + hash(index + 37) * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fillRidge(ctx: Ctx, points: number[], base: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.moveTo(points[0], base);
  for (let index = 0; index < points.length; index += 2)
    ctx.lineTo(points[index], points[index + 1]);
  ctx.lineTo(points[points.length - 2], base);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawRidges(ctx: Ctx, index: number) {
  const ridgeLayer = RIDGES[index];
  fillRidge(ctx, ridgeLayer.points, HORIZON + 60, ridgeLayer.color);
  const haze = ctx.createLinearGradient(0, HORIZON - 120, 0, HORIZON + 10);
  haze.addColorStop(0, "rgba(245,165,101,0)");
  haze.addColorStop(1, `rgba(245,165,101,${ridgeLayer.haze})`);
  ctx.fillStyle = haze;
  ctx.fillRect(-500, HORIZON - 120, 1960, 190);
}

function drawSkyline(ctx: Ctx, t: number) {
  const base = HORIZON + 22;
  for (const building of BUILDINGS) {
    const top = base - building.h;
    const body = ctx.createLinearGradient(0, top, 0, base);
    body.addColorStop(0, "#4a3248");
    body.addColorStop(1, "#30223a");
    ctx.fillStyle = body;
    ctx.fillRect(building.x, top, building.w, building.h);
    ctx.fillStyle = "rgba(255,170,110,0.35)";
    ctx.fillRect(building.x, top, building.w, 1);
    for (let row = 0; row < Math.floor(building.h / 9) - 1; row++) {
      for (let column = 0; column < Math.floor(building.w / 7); column++) {
        const seed = building.x * 0.37 + row * 13.1 + column * 7.7;
        if (hash(seed) > 0.32) continue;
        ctx.fillStyle = hash(seed + 1) > 0.5 ? "rgba(255,206,140,0.75)" : "rgba(150,210,255,0.6)";
        ctx.fillRect(building.x + 3 + column * 7, top + 5 + row * 9, 2.5, 2);
      }
    }
    if (building.beacon && Math.sin(t * 2.4 + building.x) > 0.7) {
      glow(ctx, building.x + building.w / 2, top - 2, 7, "rgba(255,70,60,1)", 0.9);
    }
  }
  const haze = ctx.createLinearGradient(0, base - 120, 0, base);
  haze.addColorStop(0, "rgba(120,80,100,0)");
  haze.addColorStop(1, "rgba(190,110,100,0.55)");
  ctx.fillStyle = haze;
  ctx.fillRect(-500, base - 120, 1960, 120);
}

function drawHills(ctx: Ctx) {
  const fill = ctx.createLinearGradient(0, GROUND - 120, 0, GROUND);
  fill.addColorStop(0, "#2a2134");
  fill.addColorStop(1, "#15121d");
  fillRidge(ctx, HILLS, GROUND + 40, fill);
}

function drawFloor(ctx: Ctx) {
  const top = GROUND - 22;
  const floor = ctx.createLinearGradient(0, top, 0, STAGE_H + 160);
  floor.addColorStop(0, "#2a2a36");
  floor.addColorStop(0.25, "#16161f");
  floor.addColorStop(1, "#08080c");
  ctx.fillStyle = floor;
  ctx.fillRect(-500, top, 1960, 420);
  const sheen = ctx.createRadialGradient(SUN.x, top, 0, SUN.x, top, 520);
  sheen.addColorStop(0, "rgba(255,170,110,0.28)");
  sheen.addColorStop(1, "rgba(255,170,110,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-500, top, 1960, 300);
  ctx.strokeStyle = "rgba(160,180,220,0.07)";
  ctx.lineWidth = 1;
  for (let x = -600; x < 1600; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(STAGE_W / 2 + (x - STAGE_W / 2) * 2.6, STAGE_H + 160);
    ctx.stroke();
  }
  for (let row = 1; row < 8; row++) {
    const y = top + row * row * 4.2;
    ctx.beginPath();
    ctx.moveTo(-500, y);
    ctx.lineTo(1460, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,190,140,0.35)";
  ctx.fillRect(-500, top, 1960, 1);
}

function floorFade(ctx: Ctx) {
  const fade = ctx.createLinearGradient(0, GROUND, 0, GROUND + 140);
  fade.addColorStop(0, "rgba(14,14,20,0.35)");
  fade.addColorStop(1, "rgba(10,10,14,1)");
  ctx.fillStyle = fade;
  ctx.fillRect(-500, GROUND, 1960, 300);
}

function metal(ctx: Ctx, rx: number, warm: boolean) {
  const gradient = ctx.createLinearGradient(-rx, 0, rx, 0);
  gradient.addColorStop(0, "#14161b");
  gradient.addColorStop(0.12, warm ? "#4a4440" : "#3d4552");
  gradient.addColorStop(0.3, warm ? "#a49a90" : "#a9b6c6");
  gradient.addColorStop(0.38, warm ? "#6e665f" : "#6b7685");
  gradient.addColorStop(0.68, warm ? "#3a3530" : "#323944");
  gradient.addColorStop(0.86, "#1d2026");
  gradient.addColorStop(0.95, "#5b4a46");
  gradient.addColorStop(1, "#24242a");
  return gradient;
}

function cylinder(
  ctx: Ctx,
  bottom: number,
  top: number,
  rx: number,
  side: CanvasGradient | string,
  cap: string,
) {
  ctx.beginPath();
  ctx.moveTo(-rx, top);
  ctx.lineTo(-rx, bottom);
  ctx.ellipse(0, bottom, rx, RY, 0, Math.PI, 0, true);
  ctx.lineTo(rx, top);
  ctx.ellipse(0, top, rx, RY, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = side;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, top, rx, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = cap;
  ctx.fill();
}

function enterTower(ctx: Ctx, tower: Tower) {
  ctx.save();
  ctx.translate(tower.x + tower.flinch * 7 + tower.tremble, GROUND);
  ctx.rotate(0.035 * tower.flinch);
  ctx.scale(1 + 0.02 * tower.recoil, 1 - 0.025 * tower.recoil);
}

const SCORCH = [
  [-22, -40],
  [26, -100],
  [-28, -144],
  [16, -58],
  [-6, -96],
];

function drawTowerBody(ctx: Ctx, tower: Tower) {
  enterTower(ctx, tower);
  const side = metal(ctx, RX, tower.warm);
  cylinder(ctx, 0, -PLINTH, RX + 8, metal(ctx, RX + 8, tower.warm), "#3a3d46");
  for (let level = 0; level < 3; level++) {
    const ring = -PLINTH - level * (PLATTER + GAP);
    cylinder(ctx, ring, ring - GAP, RX - 4, "#0b0c11", "#0b0c11");
    ctx.beginPath();
    ctx.ellipse(0, ring - GAP / 2, RX - 4, RY - 1, 0, 0.12, Math.PI - 0.12);
    ctx.strokeStyle = tower.led;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const bottom = ring - GAP;
    cylinder(ctx, bottom, bottom - PLATTER, RX, side, tower.warm ? "#6b625a" : "#7a8594");
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let line = 1; line < 4; line++) {
      ctx.beginPath();
      ctx.ellipse(0, bottom - line * 11, RX, RY, 0, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  }
  cylinder(ctx, TOP + 10, TOP, RX - 6, metal(ctx, RX - 6, tower.warm), "#4b525e");
  ctx.beginPath();
  ctx.roundRect(-34, -154, 68, 12, 6);
  ctx.fillStyle = "#06070a";
  ctx.fill();
  ctx.fillStyle = tower.led;
  ctx.beginPath();
  ctx.roundRect(tower.look * 24 - 7, -150, 14, 4, 2);
  ctx.fill();
  if (tower.warm) {
    ctx.strokeStyle = "#1a1c22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-22, TOP);
    ctx.lineTo(-24 - tower.damage * 10, TOP - 34 + tower.damage * 8);
    ctx.stroke();
    for (let index = 0; index < Math.min(SCORCH.length, Math.floor(tower.damage * 6)); index++) {
      const [x, y] = SCORCH[index];
      const burn = ctx.createRadialGradient(x, y, 0, x, y, 20);
      burn.addColorStop(0, "rgba(8,6,4,0.75)");
      burn.addColorStop(1, "rgba(8,6,4,0)");
      ctx.fillStyle = burn;
      ctx.fillRect(x - 20, y - 20, 40, 40);
    }
  } else {
    cylinder(ctx, TOP, TOP - 10, 9, metal(ctx, 9, false), "#55606e");
    ctx.save();
    ctx.translate(8, 0);
    ctx.fillStyle = metal(ctx, 6, false);
    ctx.fillRect(-6, MUZZLE.y - GROUND + 4, 12, TOP - 10 - (MUZZLE.y - GROUND + 4));
    ctx.beginPath();
    ctx.ellipse(0, MUZZLE.y - GROUND + 2, 7, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = COOL;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawTowerLight(ctx: Ctx, tower: Tower) {
  enterTower(ctx, tower);
  for (let level = 0; level < 3; level++) {
    const ring = -PLINTH - level * (PLATTER + GAP) - GAP / 2;
    ctx.beginPath();
    ctx.ellipse(0, ring, RX - 4, RY - 1, 0, 0.12, Math.PI - 0.12);
    ctx.strokeStyle = tower.led;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  glow(ctx, tower.look * 24, -148, 26, tower.led, 0.7);
  if (tower.warm && Math.sin(tower.t * 3) > 0.5) {
    glow(ctx, -24 - tower.damage * 10, TOP - 34 + tower.damage * 8, 9, WARM, 0.9);
  }
  ctx.restore();
}

function drawWreck(ctx: Ctx, t: number) {
  ctx.save();
  ctx.translate(TARGET_X, GROUND);
  cylinder(ctx, 0, -PLINTH, RX + 8, metal(ctx, RX + 8, true), "#2c2a2a");
  ctx.beginPath();
  ctx.moveTo(-RX, -PLINTH);
  const jag = [-52, -40, -40, -58, -26, -36, -10, -64, 6, -42, 22, -56, 36, -34, 50, -50, 52, -30];
  for (let index = 0; index < jag.length; index += 2) ctx.lineTo(jag[index], jag[index + 1]);
  ctx.lineTo(RX, -PLINTH);
  ctx.ellipse(0, -PLINTH, RX, RY, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = metal(ctx, RX, true);
  ctx.fill();
  const char = ctx.createLinearGradient(0, -64, 0, -20);
  char.addColorStop(0, "rgba(6,5,4,0.85)");
  char.addColorStop(1, "rgba(6,5,4,0)");
  ctx.fillStyle = char;
  ctx.fill();
  ctx.restore();
  const heat = 1 - clamp01((t - TIMELINE.boom) / 5);
  if (heat <= 0) return;
  ctx.save();
  ctx.translate(TARGET_X, GROUND);
  ctx.globalCompositeOperation = "lighter";
  ctx.beginPath();
  ctx.moveTo(-RX, -PLINTH - 26);
  for (let index = 0; index < jag.length; index += 2) ctx.lineTo(jag[index], jag[index + 1]);
  ctx.strokeStyle = `rgba(255,${120 + heat * 80},60,${0.8 * heat})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  glow(ctx, 0, -46, 70, "rgba(255,120,50,1)", 0.35 * heat);
  ctx.restore();
}

function drawRift(ctx: Ctx, t: number) {
  const open = riftOpen(t);
  if (open <= 0.01) return;
  ctx.save();
  ctx.translate(RIFT.x, RIFT.y);
  ctx.rotate(0.08);
  const rx = 6 + 34 * open;
  const ry = 180 * open;
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.2, "rgba(190,230,255,0.95)");
  core.addColorStop(0.6, "rgba(90,140,255,0.6)");
  core.addColorStop(1, "rgba(40,60,160,0)");
  ctx.scale(rx / ry, 1);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, ry, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRiftLight(ctx: Ctx, t: number) {
  const open = riftOpen(t);
  if (open <= 0.01) return;
  glow(ctx, RIFT.x, RIFT.y, 300 * open, "rgba(120,170,255,0.6)", 0.8);
  const flare = ctx.createLinearGradient(RIFT.x - 700, 0, RIFT.x + 700, 0);
  flare.addColorStop(0, "rgba(120,180,255,0)");
  flare.addColorStop(0.5, `rgba(200,230,255,${0.8 * open})`);
  flare.addColorStop(1, "rgba(120,180,255,0)");
  ctx.fillStyle = flare;
  ctx.fillRect(RIFT.x - 700, RIFT.y - 1.5, 1400, 3);
  ctx.strokeStyle = `rgba(210,235,255,${0.7 * open})`;
  ctx.lineWidth = 1.2;
  for (let bolt = 0; bolt < 3; bolt++) {
    let x = RIFT.x;
    let y = RIFT.y - 160 * open + bolt * 100 * open;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 6; step++) {
      x += (hash(Math.floor(t * 18) * 7 + bolt * 13 + step) - 0.5) * 40;
      y += 12;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

const HULL = new Path2D(
  "M-410 -8 L-360 -46 L-150 -70 L120 -64 L300 -38 L420 -8 L300 22 L120 44 L-150 54 L-360 34 Z",
);
const TOWER = new Path2D("M-270 -58 L-205 -100 L50 -108 L150 -62 Z");
const BRIDGE = new Path2D("M-130 -102 L-104 -136 L-24 -138 L2 -106 Z");
const KEEL = new Path2D("M-250 44 L210 38 L170 72 L-210 78 Z");
const PRONGS = [
  new Path2D("M250 -32 L470 -56 L480 -48 L300 -12 Z"),
  new Path2D("M250 18 L462 38 L470 46 L300 8 Z"),
];
const PANELS = Array.from({ length: 70 }, (_, index) => ({
  x: -380 + hash(index + 501) * 760,
  y: -64 + hash(index + 601) * 110,
  w: 14 + hash(index + 701) * 60,
  h: 3 + hash(index + 801) * 10,
  shade: hash(index + 901),
}));

function drawShip(ctx: Ctx, pose: Pose) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.tilt);
  ctx.scale(pose.scale, pose.scale);
  const shade = ctx.createLinearGradient(0, -140, 0, 80);
  shade.addColorStop(0, "#505665");
  shade.addColorStop(0.45, "#2a2e37");
  shade.addColorStop(1, "#0f1116");
  ctx.fillStyle = "#15171d";
  for (const prong of PRONGS) ctx.fill(prong);
  ctx.fill(KEEL);
  ctx.fillStyle = shade;
  ctx.fill(TOWER);
  ctx.fill(BRIDGE);
  ctx.fill(HULL);
  ctx.save();
  ctx.clip(HULL);
  for (const panel of PANELS) {
    ctx.fillStyle =
      panel.shade > 0.5
        ? `rgba(255,255,255,${0.03 + panel.shade * 0.04})`
        : `rgba(0,0,0,${0.12 + panel.shade * 0.2})`;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  }
  const under = ctx.createLinearGradient(0, 0, 0, 60);
  under.addColorStop(0, "rgba(0,0,0,0)");
  under.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = under;
  ctx.fillRect(-420, 0, 860, 60);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,170,110,0.55)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-360, -46);
  ctx.lineTo(-150, -70);
  ctx.lineTo(120, -64);
  ctx.lineTo(300, -38);
  ctx.lineTo(420, -8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-205, -100);
  ctx.lineTo(50, -108);
  ctx.moveTo(-104, -136);
  ctx.lineTo(-24, -138);
  ctx.stroke();
  ctx.fillStyle = "#101217";
  for (const x of [-210, 190]) {
    ctx.fillRect(x - 16, 46, 32, 14);
    ctx.fillRect(x - 4, 58, 8, 14);
  }
  ctx.beginPath();
  ctx.ellipse(-10, 82, 44, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0c0d11";
  for (const y of [-26, 0, 24]) {
    ctx.beginPath();
    ctx.ellipse(-404, y, 8, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShipLight(ctx: Ctx, pose: Pose, t: number) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.tilt);
  ctx.scale(pose.scale, pose.scale);
  for (const y of [-26, 0, 24]) {
    const length = 90 + hash(Math.floor(t * 30) + y) * 30 + pose.speed * 180;
    const flame = ctx.createLinearGradient(-404, 0, -404 - length, 0);
    flame.addColorStop(0, "rgba(230,245,255,1)");
    flame.addColorStop(0.25, "rgba(120,180,255,0.75)");
    flame.addColorStop(1, "rgba(80,120,255,0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-404, y - 9);
    ctx.lineTo(-404 - length, y);
    ctx.lineTo(-404, y + 9);
    ctx.fill();
    glow(ctx, -404, y, 46, "rgba(140,190,255,1)", 0.8);
  }
  for (let index = 0; index < 60; index++) {
    if (hash(index * 3.3 + Math.floor(t * 1.5)) < 0.18) continue;
    const x = -360 + hash(index + 1201) * 700;
    const y = -50 + hash(index + 1301) * 70;
    ctx.fillStyle = hash(index + 1401) > 0.3 ? "rgba(255,220,170,0.9)" : "rgba(170,210,255,0.9)";
    ctx.fillRect(x, y, 2, 1.4);
  }
  const blink = Math.sin(t * 4) > 0.75 ? 1 : 0.1;
  glow(ctx, 420, -8, 22, "rgba(255,70,60,1)", blink);
  glow(ctx, -360, 34, 18, "rgba(90,255,140,1)", blink);
  glow(ctx, -150, -70, 16, "rgba(255,255,255,1)", Math.sin(t * 4 + 1.5) > 0.8 ? 1 : 0);
  ctx.restore();
}

function drawSpeedLines(ctx: Ctx, pose: Pose, t: number) {
  if (pose.speed < 0.1) return;
  ctx.strokeStyle = `rgba(200,220,255,${0.18 * pose.speed})`;
  for (let index = 0; index < 14; index++) {
    const y = pose.y + (hash(index + 801) - 0.5) * 240 * pose.scale;
    const length = (90 + hash(index + 901) * 180) * pose.speed;
    const offset = ((t * 1200 + hash(index + 1001) * 900) % 900) * pose.scale;
    const x = pose.x - 300 * pose.scale - offset;
    ctx.lineWidth = 0.6 + hash(index + 1101);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - length, y);
    ctx.stroke();
  }
}

function drawOrb(ctx: Ctx, pose: Pose, t: number) {
  if (t < TIMELINE.charge || t > TIMELINE.boom + 0.35) return;
  const grow = clamp01((t - TIMELINE.charge) / (TIMELINE.boom - TIMELINE.charge));
  const fade = 1 - clamp01((t - TIMELINE.boom) / 0.35);
  const orb = shipOrb(pose);
  const radius = (6 + 34 * grow * grow + Math.sin(t * 40) * 1.2) * fade;
  if (radius <= 0.5) return;
  glow(ctx, orb.x, orb.y, radius * 4, "rgba(120,180,255,1)", 0.7);
  glow(ctx, orb.x, orb.y, radius * 1.4, "rgba(255,255,255,1)", 1);
  const flare = ctx.createLinearGradient(orb.x - 300 * grow, 0, orb.x + 300 * grow, 0);
  flare.addColorStop(0, "rgba(140,190,255,0)");
  flare.addColorStop(0.5, `rgba(220,240,255,${0.7 * grow})`);
  flare.addColorStop(1, "rgba(140,190,255,0)");
  ctx.fillStyle = flare;
  ctx.fillRect(orb.x - 300 * grow, orb.y - 1, 600 * grow, 2);
  ctx.strokeStyle = "rgba(200,230,255,0.7)";
  ctx.lineWidth = 1;
  for (let arc = 0; arc < 4; arc++) {
    let angle = hash(Math.floor(t * 24) * 5 + arc) * Math.PI * 2;
    let x = orb.x;
    let y = orb.y;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 5; step++) {
      angle += (hash(arc * 31 + step + Math.floor(t * 24)) - 0.5) * 1.3;
      x += Math.cos(angle) * radius * 0.55;
      y += Math.sin(angle) * radius * 0.55;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawBeam(ctx: Ctx, pose: Pose | null, t: number) {
  if (!pose) return;
  const local = t - (TIMELINE.boom - 0.45);
  if (local < 0 || local > 0.95) return;
  const envelope = Math.sin((local / 0.95) * Math.PI);
  const width = (26 + 44 * envelope + Math.sin(t * 60) * 3) * envelope;
  const orb = shipOrb(pose);
  const angle = Math.atan2(GROUND - 80 - orb.y, TARGET_X - orb.x);
  const length = Math.hypot(GROUND - 80 - orb.y, TARGET_X - orb.x) + 90;
  ctx.save();
  ctx.translate(orb.x, orb.y);
  ctx.rotate(angle);
  for (const [scale, color] of [
    [2.4, "rgba(80,130,255,0.18)"],
    [1.2, "rgba(140,200,255,0.55)"],
    [0.35, "rgba(255,255,255,1)"],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, (-width * scale) / 3);
    ctx.lineTo(length, (-width * scale) / 2);
    ctx.lineTo(length, (width * scale) / 2);
    ctx.lineTo(0, (width * scale) / 3);
    ctx.fill();
  }
  ctx.restore();
}

function drawTrail(ctx: Ctx, trail: number[], color: string, width: number, alpha = 0.6) {
  const count = trail.length / 2;
  if (count < 2) return;
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  for (let index = 1; index < count; index++) {
    const k = index / count;
    ctx.globalAlpha = k * k * alpha;
    ctx.lineWidth = width * k;
    ctx.beginPath();
    ctx.moveTo(trail[(index - 1) * 2], trail[(index - 1) * 2 + 1]);
    ctx.lineTo(trail[index * 2], trail[index * 2 + 1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawGlyph(ctx: Ctx, p: Particle) {
  ctx.strokeStyle = p.color;
  ctx.fillStyle = p.color;
  ctx.lineWidth = 1.2;
  switch (p.glyph) {
    case "table":
      ctx.strokeRect(-10, -7, 20, 14);
      ctx.fillRect(-10, -7, 20, 3);
      ctx.beginPath();
      ctx.moveTo(-3, -4);
      ctx.lineTo(-3, 7);
      ctx.moveTo(4, -4);
      ctx.lineTo(4, 7);
      ctx.moveTo(-10, 2);
      ctx.lineTo(10, 2);
      ctx.stroke();
      return;
    case "row":
      ctx.beginPath();
      ctx.roundRect(-13, -4, 26, 8, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(-4, 4);
      ctx.moveTo(4, -4);
      ctx.lineTo(4, 4);
      ctx.stroke();
      return;
    case "json":
      ctx.font = `600 13px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("{}", 0, 0);
      return;
    case "key":
      ctx.beginPath();
      ctx.arc(-5, 0, 4, 0, Math.PI * 2);
      ctx.moveTo(-1, 0);
      ctx.lineTo(10, 0);
      ctx.moveTo(6, 0);
      ctx.lineTo(6, 4);
      ctx.stroke();
      return;
  }
}

function drawSolidParticle(ctx: Ctx, p: Particle) {
  const k = p.age / p.life;
  if (p.kind === "smoke") {
    const fresh = clamp01(1 - p.age / 0.6);
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
    const r = Math.round(lerp(34, 90, fresh));
    const g = Math.round(lerp(32, 62, fresh));
    const b = Math.round(lerp(38, 48, fresh));
    gradient.addColorStop(0, `rgba(${r},${g},${b},${0.75 * (1 - k)})`);
    gradient.addColorStop(0.6, `rgba(${r},${g},${b},${0.45 * (1 - k)})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    return;
  }
  if (p.kind === "dust") {
    const rx = p.size * easeOutCubic(k);
    const gradient = ctx.createRadialGradient(p.x, p.y, rx * 0.4, p.x, p.y, rx);
    gradient.addColorStop(0, "rgba(120,100,90,0)");
    gradient.addColorStop(0.8, `rgba(140,115,100,${0.45 * (1 - k)})`);
    gradient.addColorStop(1, "rgba(140,115,100,0)");
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, 0.14);
    ctx.translate(-p.x, -p.y);
    ctx.fillStyle = gradient;
    ctx.fillRect(p.x - rx, p.y - rx, rx * 2, rx * 2);
    ctx.restore();
    return;
  }
  if (p.kind === "debris") {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = 1 - clamp01((k - 0.85) / 0.15);
    const shard = ctx.createLinearGradient(-p.size, -p.size, p.size, p.size);
    shard.addColorStop(0, "#c3cad4");
    shard.addColorStop(0.4, p.color);
    shard.addColorStop(1, "#14161b");
    ctx.beginPath();
    ctx.moveTo(-p.size, -p.size * 0.4);
    ctx.lineTo(p.size * 0.7, -p.size * 0.7);
    ctx.lineTo(p.size, p.size * 0.3);
    ctx.lineTo(-p.size * 0.4, p.size * 0.6);
    ctx.closePath();
    ctx.fillStyle = shard;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }
  if (p.kind === "missile") {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    const body = ctx.createLinearGradient(0, -4, 0, 4);
    body.addColorStop(0, "#9aa2ae");
    body.addColorStop(1, "#2c3038");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-11, -3);
    ctx.lineTo(7, -3);
    ctx.quadraticCurveTo(15, 0, 7, 3);
    ctx.lineTo(-11, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawLightParticle(ctx: Ctx, p: Particle, t: number) {
  const k = p.age / p.life;
  switch (p.kind) {
    case "shot": {
      if (p.trail) drawTrail(ctx, p.trail, p.color, 5, 0.8);
      if (p.trail) drawTrail(ctx, p.trail, "#ffffff", 1.6, 0.9);
      glow(ctx, p.x, p.y, 22, p.color, 0.55);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * 0.3);
      ctx.scale(p.size, p.size);
      drawGlyph(ctx, p);
      ctx.restore();
      return;
    }
    case "letter": {
      if (p.trail) drawTrail(ctx, p.trail, COOL, 4, 0.5);
      glow(ctx, p.x, p.y, 18, COOL, 0.5);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * 0.25);
      ctx.font = `600 14px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#e8f8ff";
      ctx.fillText(p.text, 0, 1);
      ctx.restore();
      return;
    }
    case "missile": {
      const flame = 14 + hash(Math.floor(t * 40) + p.tx) * 10;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const exhaust = ctx.createLinearGradient(-11, 0, -11 - flame, 0);
      exhaust.addColorStop(0, "rgba(255,240,210,1)");
      exhaust.addColorStop(1, "rgba(255,130,60,0)");
      ctx.fillStyle = exhaust;
      ctx.beginPath();
      ctx.moveTo(-11, -3);
      ctx.lineTo(-11 - flame, 0);
      ctx.lineTo(-11, 3);
      ctx.fill();
      glow(ctx, -12, 0, 14, "rgba(255,170,90,1)", 0.7);
      ctx.restore();
      return;
    }
    case "laser": {
      const width = 10 * (1 - k);
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,80,70,0.35)";
      ctx.lineWidth = width * 2.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.tx, p.ty);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,120,100,0.8)";
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,245,240,1)";
      ctx.lineWidth = width * 0.25;
      ctx.stroke();
      glow(ctx, p.x, p.y, 20 * (1 - k), "rgba(255,120,100,1)", 1);
      return;
    }
    case "spark": {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case "ember": {
      const heat = 1 - k;
      if (p.trail)
        drawTrail(ctx, p.trail, `rgba(255,${120 + heat * 100},60,1)`, p.size, heat * 0.6);
      glow(ctx, p.x, p.y, p.size * 4, "rgba(255,170,80,1)", heat);
      return;
    }
    case "fire": {
      const radius = p.size * (1 - k * 0.45);
      const heat = 1 - k;
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, `rgba(255,248,225,${heat})`);
      gradient.addColorStop(0.3, `rgba(255,190,90,${heat * 0.85})`);
      gradient.addColorStop(0.7, `rgba(230,90,40,${heat * 0.45})`);
      gradient.addColorStop(1, "rgba(120,30,20,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      return;
    }
    case "flake":
      if (p.trail) drawTrail(ctx, p.trail, p.color, p.size * 1.6, 0.8);
      return;
    case "ring": {
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * easeOutCubic(k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case "debris": {
      const heat = 1 - clamp01(p.age / 1.2);
      if (heat > 0 && p.trail) drawTrail(ctx, p.trail, "rgba(255,150,70,1)", 2, heat * 0.5);
      return;
    }
  }
}

function drawHit(ctx: Ctx, p: Particle) {
  const k = p.age / p.life;
  const pop = 1 + (1 - clamp01(k * 4)) * 0.3;
  const scale = (p.crit ? 1.2 : 1) * pop;
  const inner = 5 * scale;
  const outer = 12 * scale;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = 1 - k * k;
  ctx.lineCap = "round";
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? "rgba(0,0,0,0.5)" : p.crit ? "#ff6a5c" : "#ffffff";
    ctx.lineWidth = pass === 0 ? 3.4 : 1.6;
    ctx.beginPath();
    for (const angle of [0.785, 2.356, 3.927, 5.498]) {
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPop(ctx: Ctx, p: Particle) {
  const k = p.age / p.life;
  ctx.globalAlpha = Math.min(clamp01(p.age / 0.08), 1 - clamp01((k - 0.6) / 0.4));
  ctx.font = `500 10px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#cfefff";
  ctx.fillText(p.text, p.x, p.y);
  ctx.globalAlpha = 1;
}

function hologram(
  ctx: Ctx,
  x: number,
  width: number,
  color: string,
  flicker: number,
  towerTop: number,
) {
  ctx.save();
  ctx.globalAlpha = flicker;
  const beam = ctx.createLinearGradient(0, towerTop, 0, LABEL_Y + 14);
  beam.addColorStop(0, color);
  beam.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.12 * flicker;
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(x - 10, towerTop);
  ctx.lineTo(x + 10, towerTop);
  ctx.lineTo(x + width / 2, LABEL_Y + 13);
  ctx.lineTo(x - width / 2, LABEL_Y + 13);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = flicker;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, LABEL_Y - 13, width, 26, 3);
  ctx.fillStyle = "rgba(60,120,160,0.12)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55 * flicker;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 0.08 * flicker;
  ctx.fillStyle = color;
  for (let y = LABEL_Y - 12; y < LABEL_Y + 13; y += 3)
    ctx.fillRect(x - width / 2 + 1, y, width - 2, 1);
  ctx.restore();
}

function drawLabels(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  const name = scene.targetName;
  const width = Math.max(name.length, scene.sourceName.length) * 10 + 30;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  hologram(ctx, SOURCE_X, width, COOL, 0.92 + Math.sin(t * 23) * 0.08, MUZZLE.y - 6);
  ctx.font = `500 13px ${MONO}`;
  if (scene.stolen === 0) {
    ctx.fillStyle = "#e3f6ff";
    ctx.fillText(scene.sourceName, SOURCE_X, LABEL_Y + 1);
  } else {
    const slots = nameSlots(name, SOURCE_X);
    ctx.fillStyle = "#bfeeff";
    for (let index = 0; index < scene.stolen; index++)
      ctx.fillText(name[index], slots[index], LABEL_Y + 1);
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = "rgba(200,230,255,0.45)";
    ctx.fillText(scene.sourceName, SOURCE_X, LABEL_Y - 22);
    const strike = ctx.measureText(scene.sourceName).width / 2 + 3;
    ctx.fillStyle = "rgba(255,90,80,0.7)";
    ctx.fillRect(SOURCE_X - strike, LABEL_Y - 22, strike * 2, 1);
  }
  if (scene.destroyed) return;
  const unstable = scene.hp < 0.5 ? hash(Math.floor(t * 20)) * (1 - scene.hp) : 0;
  hologram(ctx, TARGET_X, width, WARM, 0.9 - unstable * 0.6, GROUND + TOP - 30);
  ctx.font = `500 13px ${MONO}`;
  if (scene.launched >= name.length) {
    ctx.fillStyle = "rgba(255,200,140,0.4)";
    ctx.fillText("—", TARGET_X, LABEL_Y + 1);
  } else {
    const slots = nameSlots(name, TARGET_X);
    ctx.fillStyle = "#ffe3bf";
    for (let index = scene.launched; index < name.length; index++)
      ctx.fillText(name[index], slots[index], LABEL_Y + 1);
  }
  const barW = 80;
  const hp = Math.max(0, scene.hp);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(TARGET_X - barW / 2, LABEL_Y + 19, barW, 2);
  ctx.fillStyle = hp > 0.5 ? WARM : ALARM;
  ctx.fillRect(TARGET_X - barW / 2, LABEL_Y + 19, barW * hp, 2);
}

function transferProgress(scene: Scene) {
  if (scene.destroyed) return 1;
  const letters = scene.stolen / Math.max(1, scene.targetName.length);
  return (
    letters * 0.8 + clamp01((scene.t - TIMELINE.arrival) / (TIMELINE.boom - TIMELINE.arrival)) * 0.2
  );
}

function drawHud(ctx: Ctx, scene: Scene) {
  const progress = transferProgress(scene);
  const x = 28;
  const y = 22;
  const w = 220;
  ctx.textBaseline = "middle";
  ctx.font = `600 10px ${UI}`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "left";
  ctx.fillText("TRANSFER", x, y);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(progress * 100)} %`, x + w, y);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y + 10, w, 2);
  ctx.fillStyle = COOL;
  ctx.fillRect(x, y + 10, w * progress, 2);
  ctx.font = `500 18px ${MONO}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(scene.rows.toLocaleString("de-DE"), STAGE_W - 28, y + 2);
  ctx.font = `600 9px ${UI}`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText("ZEILEN ÜBERTRAGEN", STAGE_W - 28, y + 18);
}

function fillTemplate(text: string, scene: Scene) {
  return text.replaceAll("{source}", scene.sourceName).replaceAll("{target}", scene.targetName);
}

function drawLog(ctx: Ctx, scene: Scene, bars: number) {
  const t = scene.t;
  const active = LOG.filter((entry) => t >= entry.from && t <= entry.to).slice(-3);
  const base = STAGE_H - 20 - (1 - bars) * 14;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  active.forEach((entry, index) => {
    const y = base - (active.length - 1 - index) * 15;
    const alpha = Math.min(clamp01((t - entry.from) / 0.15), clamp01((entry.to - t) / 0.3));
    const full = fillTemplate(entry.text, scene);
    const shown = full.slice(0, Math.floor((t - entry.from) * 42));
    const tag = TAGS[entry.speaker];
    ctx.globalAlpha = alpha;
    ctx.font = `600 10px ${MONO}`;
    ctx.fillStyle = tag.color;
    ctx.fillText(tag.label, 28, y);
    ctx.font = `400 11px ${MONO}`;
    ctx.fillStyle = "rgba(235,240,250,0.9)";
    ctx.fillText(shown, 118, y);
    if (shown.length < full.length || Math.sin(t * 8) > 0) {
      const width = ctx.measureText(shown).width;
      ctx.fillStyle = tag.color;
      ctx.fillRect(120 + width, y - 5, 5, 10);
    }
  });
  ctx.globalAlpha = 1;
}

function drawTitle(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  if (t < TIMELINE.outro + 1.6) return;
  const k = easeOutCubic(clamp01((t - TIMELINE.outro - 1.6) / 1.1));
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(STAGE_W / 2 + 120, 196 + (1 - k) * 10);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 10px ${UI}`;
  ctx.fillStyle = "rgba(220,235,255,0.7)";
  ctx.fillText("TRANSFER ABGESCHLOSSEN", 0, -30);
  ctx.font = `600 32px ${UI}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(scene.targetName, 0, 4);
  ctx.font = `400 12px ${MONO}`;
  ctx.fillStyle = "rgba(220,235,255,0.7)";
  ctx.fillText(`${scene.rows.toLocaleString("de-DE")} Zeilen`, 0, 34);
  ctx.fillStyle = COOL;
  ctx.fillRect(0, -16, 40 * k, 1.5);
  ctx.restore();
}

function towers(scene: Scene, pose: Pose | null) {
  const t = scene.t;
  const sourceLook = pose && t < TIMELINE.boom + 0.6 ? -0.3 : 0.9;
  const damage = 1 - scene.hp;
  const flicker = hash(Math.floor(t * 18)) < damage * 0.55;
  const source: Tower = {
    x: SOURCE_X,
    warm: false,
    recoil: scene.recoil,
    flinch: 0,
    tremble: 0,
    look: sourceLook + Math.sin(t * 0.7) * 0.1,
    led: COOL,
    damage: 0,
    t,
  };
  const target: Tower = {
    x: TARGET_X,
    warm: true,
    recoil: 0,
    flinch: scene.flinch,
    tremble: pose ? Math.sin(t * 46) * 1.2 : 0,
    look: pose ? -0.4 + Math.sin(t * 9) * 0.5 : -0.9 + Math.sin(t * 1.3) * 0.08,
    led: flicker || scene.flinch > 0.6 ? ALARM : WARM,
    damage,
    t,
  };
  return { source, target };
}

export function drawScene(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  const pose = shipPose(t);
  const cam = camera(t);
  const shakeX = (Math.random() * 2 - 1) * scene.shake;
  const shakeY = (Math.random() * 2 - 1) * scene.shake;
  const night = nightAmount(t);
  const { source, target } = towers(scene, pose);

  ctx.save();
  ctx.translate(shakeX, shakeY);
  enterLayer(ctx, cam, 0.04);
  drawSky(ctx, t);
  ctx.restore();
  enterLayer(ctx, cam, 0.14);
  drawRidges(ctx, 0);
  ctx.restore();
  enterLayer(ctx, cam, 0.26);
  drawRidges(ctx, 1);
  ctx.restore();
  enterLayer(ctx, cam, 1);
  drawRift(ctx, t);
  if (pose) {
    drawSpeedLines(ctx, pose, t);
    drawShip(ctx, pose);
  }
  ctx.restore();
  enterLayer(ctx, cam, 0.42);
  drawSkyline(ctx, t);
  ctx.restore();
  enterLayer(ctx, cam, 0.7);
  drawHills(ctx);
  ctx.restore();
  enterLayer(ctx, cam, 1);
  drawFloor(ctx);
  ctx.save();
  ctx.translate(0, GROUND * 2);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.3;
  drawTowerBody(ctx, source);
  if (!scene.destroyed) drawTowerBody(ctx, target);
  ctx.restore();
  ctx.globalAlpha = 1;
  floorFade(ctx);
  for (const x of [SOURCE_X, TARGET_X]) {
    const shadow = ctx.createRadialGradient(x, GROUND, 0, x, GROUND, 90);
    shadow.addColorStop(0, "rgba(0,0,0,0.55)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(x, GROUND);
    ctx.scale(1, 0.18);
    ctx.translate(-x, -GROUND);
    ctx.fillStyle = shadow;
    ctx.fillRect(x - 90, GROUND - 90, 180, 180);
    ctx.restore();
  }
  for (const p of scene.particles) {
    if ((p.kind === "smoke" && p.y > GROUND - 80) || p.kind === "dust") drawSolidParticle(ctx, p);
  }
  drawTowerBody(ctx, source);
  if (scene.destroyed) drawWreck(ctx, t);
  else drawTowerBody(ctx, target);
  for (const p of scene.particles) {
    if (p.kind === "debris" || p.kind === "missile") drawSolidParticle(ctx, p);
  }
  for (const p of scene.particles) {
    if (p.kind === "smoke" && p.y <= GROUND - 80) drawSolidParticle(ctx, p);
  }
  ctx.restore();
  ctx.restore();

  if (night > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgba(96, 104, 160, ${0.5 * night})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.restore();
  }
  if (t > TIMELINE.charge && t < TIMELINE.boom) {
    ctx.fillStyle = `rgba(255, 50, 60, ${0.04 + 0.03 * Math.sin(t * 10)})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);
  enterLayer(ctx, cam, 1);
  ctx.globalCompositeOperation = "lighter";
  drawRiftLight(ctx, t);
  if (pose) {
    drawShipLight(ctx, pose, t);
    drawOrb(ctx, pose, t);
  }
  drawTowerLight(ctx, source);
  if (!scene.destroyed) drawTowerLight(ctx, target);
  glow(ctx, MUZZLE.x, MUZZLE.y, 10 + 30 * scene.recoil, COOL, 0.5 + 0.5 * scene.recoil);
  for (const p of scene.particles) drawLightParticle(ctx, p, t);
  drawBeam(ctx, pose, t);
  if (scene.flash > 0.02) {
    glow(ctx, TARGET_X, GROUND - 80, 620, "rgba(255,200,140,1)", 0.9 * scene.flash);
    const streak = ctx.createLinearGradient(TARGET_X - 900, 0, TARGET_X + 900, 0);
    streak.addColorStop(0, "rgba(255,200,150,0)");
    streak.addColorStop(0.5, `rgba(255,235,210,${scene.flash})`);
    streak.addColorStop(1, "rgba(255,200,150,0)");
    ctx.fillStyle = streak;
    ctx.fillRect(TARGET_X - 900, GROUND - 82, 1800, 4);
  }
  drawLabels(ctx, scene);
  for (const p of scene.particles) if (p.kind === "pop") drawPop(ctx, p);
  ctx.globalCompositeOperation = "source-over";
  for (const p of scene.particles) if (p.kind === "hit") drawHit(ctx, p);
  ctx.restore();
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    STAGE_W / 2,
    STAGE_H / 2,
    STAGE_H * 0.4,
    STAGE_W / 2,
    STAGE_H / 2,
    STAGE_W * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, `rgba(0,0,0,${0.5 + night * 0.2})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const pattern = grainPattern(ctx);
  if (pattern) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = "overlay";
    ctx.translate(Math.random() * 160, Math.random() * 160);
    ctx.fillStyle = pattern;
    ctx.fillRect(-160, -160, STAGE_W + 160, STAGE_H + 160);
    ctx.restore();
  }

  const bars =
    easeInOut(clamp01((t - TIMELINE.rift) / 0.8)) *
    (1 - easeInOut(clamp01((t - TIMELINE.outro - 1.2) / 0.8)));
  if (bars > 0) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, STAGE_W, 46 * bars);
    ctx.fillRect(0, STAGE_H - 46 * bars, STAGE_W, 46 * bars);
  }
  drawTitle(ctx, scene);
  drawHud(ctx, scene);
  drawLog(ctx, scene, bars);
  if (scene.flash > 0.02) {
    ctx.fillStyle = `rgba(255, 248, 236, ${scene.flash * 0.8})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
}
