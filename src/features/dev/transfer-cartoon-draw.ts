import {
  clamp01,
  easeInOut,
  easeOutCubic,
  GROUND,
  LABEL_Y,
  MUZZLE,
  nameSlots,
  type Particle,
  PORTAL,
  portalOpen,
  type Scene,
  SOURCE_X,
  STAGE_H,
  STAGE_W,
  shipOrb,
  shipPose,
  TARGET_X,
  TIMELINE,
} from "./transfer-cartoon-sim";

type Ctx = CanvasRenderingContext2D;
type Pose = NonNullable<ReturnType<typeof shipPose>>;

const INK = "#1b1424";
const FONT = '"Avenir Next", "Trebuchet MS", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const SOURCE_SKIN = { body: "#b9e3f5", dark: "#82b9d6", light: "#e8f7ff" };
const TARGET_SKIN = { body: "#f6d94a", dark: "#d4ae22", light: "#fff3a6" };

function hash(value: number) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const STARS = Array.from({ length: 80 }, (_, index) => ({
  x: hash(index + 1) * STAGE_W,
  y: hash(index + 101) * 300,
  r: 0.6 + hash(index + 201) * 1.6,
  phase: hash(index + 301) * 6,
}));

const PLANTS = [60, 130, 330, 420, 520, 610, 880, 930].map((x, index) => ({
  x,
  h: 26 + hash(index + 401) * 40,
  bulb: index % 3 === 0 ? "#ff7ad9" : index % 3 === 1 ? "#97ce4c" : "#ffb347",
  lean: (hash(index + 501) - 0.5) * 0.5,
}));

const CRACKS = [
  [-30, -110, -18, -96, -26, -84, -12, -72],
  [34, -128, 22, -112, 32, -100],
  [-44, -50, -30, -44, -36, -30],
  [20, -60, 34, -48, 26, -34, 40, -22],
  [-6, -136, 4, -124, -4, -116],
];

function boil(t: number, salt: number, amount = 1) {
  return (hash(Math.floor(t * 12) * 7.13 + salt) - 0.5) * 2 * amount;
}

function easeOutBack(value: number) {
  const c = 2.2;
  return 1 + (c + 1) * (value - 1) ** 3 + c * (value - 1) ** 2;
}

function easeOutBounce(value: number) {
  const n = 7.5625;
  const d = 2.75;
  if (value < 1 / d) return n * value * value;
  if (value < 2 / d) return n * (value - 1.5 / d) ** 2 + 0.75;
  if (value < 2.5 / d) return n * (value - 2.25 / d) ** 2 + 0.9375;
  return n * (value - 2.625 / d) ** 2 + 0.984375;
}

function ink(ctx: Ctx, width: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function outlinedText(ctx: Ctx, text: string, x: number, y: number, fill: string, stroke = 5) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawSky(ctx: Ctx, t: number, pose: Pose | null) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, "#1a0d36");
  sky.addColorStop(0.55, "#3b1f6e");
  sky.addColorStop(1, "#1f6a72");
  ctx.fillStyle = sky;
  ctx.fillRect(-40, -40, STAGE_W + 80, STAGE_H + 80);
  for (const star of STARS) {
    ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.7 + star.phase));
    ctx.fillStyle = "#fff8d6";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(770, 96);
  ctx.beginPath();
  ctx.arc(0, 0, 54, 0, Math.PI * 2);
  ctx.fillStyle = "#ff8fb1";
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(22, 16, 54, 0, Math.PI * 2);
  ctx.fillStyle = "#d9628c";
  ctx.fill();
  for (const [cx, cy, r] of [
    [-18, -14, 9],
    [10, -26, 5],
    [-26, 18, 6],
  ]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#e9779e";
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 54, 0, Math.PI * 2);
  ink(ctx, 4);
  ctx.beginPath();
  ctx.ellipse(0, 4, 92, 16, -0.25, 0.1, Math.PI - 0.1, false);
  ctx.strokeStyle = "#ffd36b";
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();
  if (pose) {
    const dim =
      clamp01((t - TIMELINE.arrival) / 1.2) * (1 - clamp01((t - TIMELINE.outro - 1) / 1.5));
    ctx.fillStyle = `rgba(8, 0, 22, ${0.42 * dim})`;
    ctx.fillRect(-40, -40, STAGE_W + 80, STAGE_H + 80);
  }
  if (t > TIMELINE.charge && t < TIMELINE.boom) {
    ctx.fillStyle = `rgba(255, 40, 60, ${0.08 + 0.08 * Math.sin(t * 14)})`;
    ctx.fillRect(-40, -40, STAGE_W + 80, STAGE_H + 80);
  }
}

function drawGround(ctx: Ctx, t: number) {
  ctx.beginPath();
  ctx.moveTo(-40, GROUND - 40);
  for (let x = -40; x <= STAGE_W + 40; x += 40) {
    ctx.lineTo(x, GROUND - 46 - Math.sin(x * 0.013) * 22 - Math.sin(x * 0.031) * 8);
  }
  ctx.lineTo(STAGE_W + 40, GROUND);
  ctx.lineTo(-40, GROUND);
  ctx.closePath();
  ctx.fillStyle = "#24525a";
  ctx.fill();
  ink(ctx, 3);
  for (const plant of PLANTS) {
    ctx.save();
    ctx.translate(plant.x, GROUND + 4);
    ctx.rotate(plant.lean + Math.sin(t * 2 + plant.x) * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(8, -plant.h * 0.5, 0, -plant.h);
    ink(ctx, 4);
    ctx.beginPath();
    ctx.arc(0, -plant.h - 7, 9, 0, Math.PI * 2);
    ctx.fillStyle = plant.bulb;
    ctx.fill();
    ink(ctx, 3);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(-40, GROUND);
  for (let x = -40; x <= STAGE_W + 40; x += 60) ctx.lineTo(x, GROUND + Math.sin(x * 0.05) * 3);
  ctx.lineTo(STAGE_W + 40, STAGE_H + 40);
  ctx.lineTo(-40, STAGE_H + 40);
  ctx.closePath();
  ctx.fillStyle = "#4f9a6a";
  ctx.fill();
  ink(ctx, 4);
  ctx.fillStyle = "#3f7f57";
  for (let index = 0; index < 14; index++) {
    ctx.beginPath();
    ctx.ellipse(
      hash(index + 601) * STAGE_W,
      GROUND + 22 + hash(index + 701) * 80,
      18,
      5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawPortal(ctx: Ctx, t: number) {
  const open = portalOpen(t);
  if (open <= 0.01) return;
  ctx.save();
  ctx.translate(PORTAL.x, PORTAL.y);
  ctx.scale(open, open);
  ctx.rotate(-0.25);
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 160);
  glow.addColorStop(0, "rgba(151, 206, 76, 0.55)");
  glow.addColorStop(1, "rgba(151, 206, 76, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-170, -170, 340, 340);
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  for (let index = 0; index <= 40; index++) {
    const angle = (index / 40) * Math.PI * 2;
    const wobble = 1 + boil(t, index, 0.06);
    ctx.lineTo(Math.cos(angle) * 78 * wobble, Math.sin(angle) * 100 * wobble);
  }
  ctx.closePath();
  const fill = ctx.createRadialGradient(0, 0, 4, 0, 0, 100);
  fill.addColorStop(0, "#f2ffd6");
  fill.addColorStop(0.35, "#b6f05c");
  fill.addColorStop(1, "#2f8f1f");
  ctx.fillStyle = fill;
  ctx.fill();
  ink(ctx, 5);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(230, 255, 190, 0.85)";
  ctx.lineWidth = 5;
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    for (let step = 0; step < 30; step++) {
      const angle = t * 5 + arm * (Math.PI / 2) + step * 0.22;
      const radius = 6 + step * 3.4;
      ctx.lineTo(Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function drawSpeedLines(ctx: Ctx, pose: Pose, t: number) {
  const amount = clamp01(pose.speed);
  if (amount < 0.1) return;
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 * amount})`;
  ctx.lineCap = "round";
  for (let index = 0; index < 16; index++) {
    const y = pose.y + (hash(index + 801) - 0.5) * 220 * pose.scale;
    const length = (80 + hash(index + 901) * 160) * amount;
    const offset = ((t * 1400 + hash(index + 1001) * 900) % 900) * pose.scale;
    const x = pose.x - 200 * pose.scale - offset;
    ctx.lineWidth = 1 + hash(index + 1101) * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - length, y);
    ctx.stroke();
  }
}

function drawShip(ctx: Ctx, pose: Pose, t: number) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.tilt);
  ctx.scale(pose.scale, pose.scale);
  ctx.globalCompositeOperation = "lighter";
  for (const y of [-26, 4, 32]) {
    const length = 70 + hash(Math.floor(t * 30) + y) * 50 + pose.speed * 120;
    const flame = ctx.createLinearGradient(-350, 0, -350 - length, 0);
    flame.addColorStop(0, "rgba(255, 245, 200, 0.95)");
    flame.addColorStop(0.35, "rgba(63, 208, 255, 0.8)");
    flame.addColorStop(1, "rgba(63, 208, 255, 0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-345, y - 13);
    ctx.lineTo(-345 - length, y);
    ctx.lineTo(-345, y + 13);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  for (const y of [-26, 4, 32]) {
    ctx.beginPath();
    ctx.ellipse(-342, y, 12, 17, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#2a2e38";
    ctx.fill();
    ink(ctx, 4);
  }
  ctx.beginPath();
  ctx.moveTo(-200, -56);
  ctx.lineTo(-150, -98);
  ctx.lineTo(70, -104);
  ctx.lineTo(140, -58);
  ctx.closePath();
  ctx.fillStyle = "#5f6880";
  ctx.fill();
  ink(ctx, 5);
  ctx.beginPath();
  ctx.ellipse(-10, -102, 54, 34, 0, Math.PI, 0);
  ctx.fillStyle = "#97ce4c";
  ctx.fill();
  ink(ctx, 5);
  ctx.beginPath();
  ctx.ellipse(-26, -114, 16, 8, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-110, -100);
  ctx.lineTo(-122, -150);
  ink(ctx, 4);
  ctx.beginPath();
  ctx.arc(-122, -154, 7, 0, Math.PI * 2);
  ctx.fillStyle = Math.sin(t * 8) > 0 ? "#ff3b3b" : "#6b1a1a";
  ctx.fill();
  ink(ctx, 3);
  const hull = new Path2D(
    "M-345 6 L-300 -44 L-120 -64 L180 -56 L350 -8 L305 30 L-60 52 L-300 42 Z",
  );
  ctx.fillStyle = "#4b5263";
  ctx.fill(hull);
  ctx.save();
  ctx.clip(hull);
  ctx.fillStyle = "#363b49";
  ctx.beginPath();
  ctx.moveTo(-360, 14);
  ctx.lineTo(360, 0);
  ctx.lineTo(360, 80);
  ctx.lineTo(-360, 80);
  ctx.fill();
  ctx.strokeStyle = "#ff5a3c";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(-360, -6);
  ctx.lineTo(360, -18);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  for (const x of [-220, -80, 60, 200]) {
    ctx.beginPath();
    ctx.moveTo(x, -70);
    ctx.lineTo(x + 10, 60);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke(hull);
  for (let index = 0; index < 15; index++) {
    const x = -250 + index * 32;
    const lit = hash(index + Math.floor(t * 3)) > 0.25;
    roundRect(ctx, x, -38 + index * -0.6, 16, 10, 3);
    ctx.fillStyle = lit ? "#f2e94e" : "#2a2e38";
    ctx.fill();
    ink(ctx, 2.5);
  }
  ctx.font = `900 30px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  outlinedText(ctx, "SELECT * FROM", -40, 26, "#f2e94e", 7);
  ctx.beginPath();
  ctx.arc(268, -18, 20, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ink(ctx, 4);
  ctx.beginPath();
  ctx.arc(276, -14, 7, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(240, -48);
  ctx.lineTo(296, -30);
  ink(ctx, 8);
  for (const x of [-170, 150]) {
    roundRect(ctx, x - 20, 40, 40, 18, 6);
    ctx.fillStyle = "#5f6880";
    ctx.fill();
    ink(ctx, 4);
    roundRect(ctx, x - 7, 52, 14, 22, 3);
    ctx.fillStyle = "#2a2e38";
    ctx.fill();
    ink(ctx, 4);
  }
  ctx.beginPath();
  ctx.ellipse(-10, 58, 34, 14, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#2a2e38";
  ctx.fill();
  ink(ctx, 5);
  ctx.restore();
}

function drawOrb(ctx: Ctx, pose: Pose, t: number) {
  if (t < TIMELINE.charge || t > TIMELINE.boom + 0.35) return;
  const grow = clamp01((t - TIMELINE.charge) / (TIMELINE.boom - TIMELINE.charge));
  const fade = 1 - clamp01((t - TIMELINE.boom) / 0.35);
  const orb = shipOrb(pose);
  const radius = (10 + 52 * grow * grow + boil(t, 3, 4)) * fade;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, radius * 2.6);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.3, "rgba(151,206,76,0.9)");
  glow.addColorStop(1, "rgba(63,208,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(orb.x, orb.y, radius * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(220,255,180,0.9)";
  ctx.lineWidth = 2.5;
  for (let arc = 0; arc < 5; arc++) {
    let angle = hash(Math.floor(t * 20) * 5 + arc) * Math.PI * 2;
    let x = orb.x;
    let y = orb.y;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 5; step++) {
      angle += (hash(arc * 31 + step + Math.floor(t * 20)) - 0.5) * 1.4;
      x += Math.cos(angle) * radius * 0.6;
      y += Math.sin(angle) * radius * 0.6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(orb.x, orb.y, radius * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = "#f4ffe0";
  ctx.fill();
  ink(ctx, 3);
}

function drawBeam(ctx: Ctx, pose: Pose | null, t: number) {
  if (!pose) return;
  const local = t - (TIMELINE.boom - 0.45);
  if (local < 0 || local > 0.95) return;
  const envelope = Math.sin((local / 0.95) * Math.PI);
  const width = (40 + 60 * envelope + boil(t, 9, 8)) * envelope;
  const orb = shipOrb(pose);
  const angle = Math.atan2(GROUND - 70 - orb.y, TARGET_X - orb.x);
  const length = Math.hypot(GROUND - 70 - orb.y, TARGET_X - orb.x) + 90;
  ctx.save();
  ctx.translate(orb.x, orb.y);
  ctx.rotate(angle);
  ctx.globalCompositeOperation = "lighter";
  for (const [scale, color] of [
    [1.8, "rgba(63,208,255,0.35)"],
    [1.1, "rgba(151,206,76,0.8)"],
    [0.45, "rgba(255,255,255,1)"],
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

function drawEye(ctx: Ctx, x: number, y: number, r: number, lx: number, ly: number, pupil = 3.6) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ink(ctx, 3.5);
  ctx.beginPath();
  ctx.arc(x + lx * (r - pupil - 3), y + ly * (r - pupil - 3), pupil, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
}

function drawCylinder(
  ctx: Ctx,
  w: number,
  h: number,
  skin: typeof SOURCE_SKIN,
  t: number,
  salt: number,
) {
  const rx = w / 2;
  const ry = 18;
  const body = new Path2D();
  body.moveTo(-rx, -h);
  body.lineTo(-rx, 0);
  body.ellipse(0, 0, rx, ry, 0, Math.PI, 0, true);
  body.lineTo(rx, -h);
  body.ellipse(0, -h, rx, ry, 0, 0, Math.PI, false);
  body.closePath();
  ctx.save();
  ctx.translate(boil(t, salt, 0.8), boil(t, salt + 1, 0.8));
  ctx.rotate(boil(t, salt + 2, 0.006));
  ctx.fillStyle = skin.body;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = skin.dark;
  ctx.beginPath();
  ctx.ellipse(rx * 1.05, -h / 2, rx * 0.5, h, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skin.light;
  ctx.fillRect(-rx + 10, -h + 20, 8, h - 34);
  ctx.restore();
  for (const level of [h / 3, (h * 2) / 3]) {
    ctx.beginPath();
    ctx.ellipse(0, -level, rx, ry, 0, 0.15, Math.PI - 0.15, false);
    ink(ctx, 3);
  }
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke(body);
  ctx.beginPath();
  ctx.ellipse(0, -h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.light;
  ctx.fill();
  ink(ctx, 5);
  ctx.restore();
}

function lookAt(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  return { lx: dx / length, ly: dy / length };
}

function drawSource(ctx: Ctx, scene: Scene, pose: Pose | null) {
  const t = scene.t;
  const drop = easeOutBounce(clamp01(t / 0.9));
  const r = scene.recoil;
  const cool = t > TIMELINE.outro;
  ctx.save();
  ctx.translate(SOURCE_X - r * 8, GROUND - (1 - drop) * 420);
  ctx.rotate(-0.05 * r);
  ctx.scale(1 + 0.09 * r, 1 - 0.08 * r + Math.sin(t * 6) * 0.015);
  const hairY = -150;
  ctx.beginPath();
  ctx.moveTo(-58, hairY + 4);
  const spikes = [
    [-62, -196],
    [-30, -172],
    [-14, -214],
    [8, -176],
    [30, -210],
    [44, -172],
    [74, -190],
  ];
  for (const [x, y] of spikes) ctx.lineTo(x + boil(t, x, 1.5), y + boil(t, y, 1.5));
  ctx.lineTo(58, hairY + 4);
  ctx.closePath();
  ctx.fillStyle = "#d7f0fb";
  ctx.fill();
  ink(ctx, 4.5);
  drawCylinder(ctx, 124, 150, SOURCE_SKIN, t, 11);
  const target = pose && t < TIMELINE.boom + 0.5 ? shipOrb(pose) : { x: TARGET_X, y: GROUND - 90 };
  const { lx, ly } = lookAt(SOURCE_X, GROUND - 95, target.x, target.y);
  drawEye(ctx, -22, -96, 18, lx, ly, 3);
  drawEye(ctx, 15, -98, 16, lx, ly, 2.6);
  ctx.beginPath();
  ctx.moveTo(-44, -120);
  for (let x = -44; x <= 36; x += 8) ctx.lineTo(x, -121 + Math.sin(x * 0.4 + t * 3) * 2.5);
  ink(ctx, 6);
  if (r > 0.35 && !cool) {
    ctx.beginPath();
    ctx.ellipse(-2, -54, 20, 14 * r + 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#4a1020";
    ctx.fill();
    ink(ctx, 4);
    ctx.beginPath();
    ctx.ellipse(-2, -48, 10, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ff6f8a";
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(-30, -60);
    ctx.quadraticCurveTo(0, -44, 28, -66);
    ctx.quadraticCurveTo(2, -36, -30, -60);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ink(ctx, 4);
    for (const x of [-16, -4, 8, 18]) {
      ctx.beginPath();
      ctx.moveTo(x, -60 + (x + 30) * -0.1);
      ctx.lineTo(x, -48 - (x + 30) * 0.05);
      ink(ctx, 2);
    }
    const drool = (t * 0.7) % 1;
    ctx.beginPath();
    ctx.moveTo(-30, -60);
    ctx.quadraticCurveTo(-34, -52 + drool * 10, -31, -46 + drool * 16);
    ctx.strokeStyle = "rgba(230,250,255,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (cool) {
    const slide = easeOutBounce(clamp01((t - TIMELINE.outro - 0.2) / 0.6));
    ctx.save();
    ctx.translate(0, -140 * (1 - slide));
    ctx.beginPath();
    ctx.moveTo(-46, -104);
    ctx.lineTo(38, -106);
    ink(ctx, 5);
    for (const [x, w] of [
      [-22, 24],
      [15, 22],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x - w, -106);
      ctx.lineTo(x + w, -106);
      ctx.quadraticCurveTo(x + w, -84, x, -84);
      ctx.quadraticCurveTo(x - w, -84, x - w, -106);
      ctx.fillStyle = "#14101c";
      ctx.fill();
      ink(ctx, 3);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, -101);
      ctx.lineTo(x - w * 0.1, -101);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.translate(56, -64);
  ctx.rotate(-0.08 - r * 0.35);
  ctx.translate(-r * 12, 0);
  ctx.beginPath();
  ctx.moveTo(-14, 6);
  ctx.lineTo(14, 2);
  ink(ctx, 6);
  roundRect(ctx, 8, -12, 46, 22, 6);
  ctx.fillStyle = "#c9cdd6";
  ctx.fill();
  ink(ctx, 4);
  roundRect(ctx, 50, -7, 16, 12, 3);
  ctx.fillStyle = "#97ce4c";
  ctx.fill();
  ink(ctx, 3.5);
  roundRect(ctx, 18, -20, 22, 10, 4);
  ctx.fillStyle = "#97ce4c";
  ctx.fill();
  ink(ctx, 3);
  ctx.restore();
  ctx.restore();
  if (r > 0.25) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const flash = ctx.createRadialGradient(MUZZLE.x, MUZZLE.y, 0, MUZZLE.x, MUZZLE.y, 34 * r);
    flash.addColorStop(0, "rgba(255,255,255,0.95)");
    flash.addColorStop(1, "rgba(151,206,76,0)");
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(MUZZLE.x, MUZZLE.y, 34 * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawTarget(ctx: Ctx, scene: Scene, pose: Pose | null) {
  const t = scene.t;
  const drop = easeOutBounce(clamp01((t - 0.15) / 0.9));
  const f = scene.flinch;
  const panic = pose ? 1 : 0;
  const tremble = Math.sin(t * 50) * (1.5 + panic * 2.5);
  ctx.save();
  ctx.translate(TARGET_X + f * 16 + tremble, GROUND - (1 - drop) * 420);
  ctx.rotate(0.11 * f);
  ctx.scale(1 - 0.1 * f, 1 + 0.06 * f);
  for (const side of [-1, 1]) {
    const wave = Math.sin(t * (12 + panic * 14) + side) * (0.5 + panic * 0.4);
    ctx.beginPath();
    ctx.moveTo(side * 58, -70);
    ctx.quadraticCurveTo(side * 84, -90 + wave * 20, side * 80, -120 + wave * 26);
    ink(ctx, 5);
    ctx.beginPath();
    ctx.arc(side * 80, -124 + wave * 26, 7, 0, Math.PI * 2);
    ctx.fillStyle = TARGET_SKIN.light;
    ctx.fill();
    ink(ctx, 3);
  }
  drawCylinder(ctx, 120, 146, TARGET_SKIN, t, 23);
  ctx.beginPath();
  ctx.ellipse(0, -150, 62, 22, 0, Math.PI, 0);
  ctx.lineTo(62, -144);
  ctx.quadraticCurveTo(0, -128, -62, -144);
  ctx.closePath();
  ctx.fillStyle = "#7a4a22";
  ctx.fill();
  ink(ctx, 4.5);
  const cracks = Math.floor((1 - scene.hp) * 6);
  for (let index = 0; index < Math.min(cracks, CRACKS.length); index++) {
    const crack = CRACKS[index];
    ctx.beginPath();
    ctx.moveTo(crack[0], crack[1]);
    for (let point = 2; point < crack.length; point += 2)
      ctx.lineTo(crack[point], crack[point + 1]);
    ink(ctx, 3);
  }
  if (scene.hp < 0.55) {
    ctx.save();
    ctx.translate(30, -40);
    ctx.rotate(0.6);
    roundRect(ctx, -22, -7, 44, 14, 5);
    ctx.fillStyle = "#f3c9a4";
    ctx.fill();
    ink(ctx, 3);
    ctx.rotate(-1.2);
    roundRect(ctx, -22, -7, 44, 14, 5);
    ctx.fill();
    ink(ctx, 3);
    ctx.restore();
  }
  if (f > 0.45) {
    for (const [x, dir] of [
      [-22, 1],
      [18, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x - 12 * dir, -106);
      ctx.lineTo(x + 6 * dir, -98);
      ctx.lineTo(x - 12 * dir, -90);
      ink(ctx, 5);
    }
    ctx.beginPath();
    ctx.ellipse(-2, -56, 14, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#4a1020";
    ctx.fill();
    ink(ctx, 4);
  } else {
    const look = pose ? lookAt(TARGET_X, GROUND - 95, pose.x, pose.y) : { lx: -1, ly: 0.1 };
    const shiver = boil(t * 2, 5, 0.25);
    const size = pose ? 21 : 18;
    drawEye(ctx, -22, -98, size, look.lx + shiver, look.ly, pose ? 2.2 : 3.4);
    drawEye(ctx, 18, -98, size - 1, look.lx + shiver, look.ly, pose ? 2.2 : 3.4);
    ctx.beginPath();
    ctx.moveTo(-40, -126);
    ctx.lineTo(-10, -134);
    ctx.moveTo(36, -126);
    ctx.lineTo(6, -134);
    ink(ctx, 5);
    if (pose) {
      ctx.beginPath();
      ctx.moveTo(-26, -52);
      for (let x = -26; x <= 24; x += 5) ctx.lineTo(x, -54 + Math.sin(x * 0.6 + t * 30) * 4);
      ctx.quadraticCurveTo(0, -24, -26, -52);
      ctx.fillStyle = "#4a1020";
      ctx.fill();
      ink(ctx, 4);
    } else {
      ctx.beginPath();
      ctx.moveTo(-22, -56);
      for (let x = -22; x <= 20; x += 4) ctx.lineTo(x, -56 + Math.sin(x * 0.5 + t * 12) * 3);
      ink(ctx, 4);
    }
  }
  for (let bead = 0; bead < 2 + panic * 2; bead++) {
    const phase = (t * 1.4 + bead * 0.37) % 1;
    const x = 44 + bead * 9 - (bead % 2) * 92;
    const y = -136 + phase * 50;
    ctx.globalAlpha = 1 - phase;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.quadraticCurveTo(x + 7, y + 2, x, y + 4);
    ctx.quadraticCurveTo(x - 7, y + 2, x, y - 10);
    ctx.fillStyle = "#9fe3ff";
    ctx.fill();
    ink(ctx, 2.5);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawWreck(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  ctx.save();
  ctx.translate(TARGET_X, GROUND);
  ctx.beginPath();
  ctx.ellipse(0, 4, 110, 18, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#1c2a24";
  ctx.fill();
  ink(ctx, 4);
  ctx.beginPath();
  ctx.moveTo(-60, 0);
  ctx.lineTo(-60, -34);
  const jag = [-44, -52, -30, -30, -14, -58, 4, -36, 20, -50, 38, -28, 52, -46, 60, -32];
  for (let index = 0; index < jag.length; index += 2) ctx.lineTo(jag[index], jag[index + 1]);
  ctx.lineTo(60, 0);
  ctx.ellipse(0, 0, 60, 18, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = "#6b5a33";
  ctx.fill();
  ink(ctx, 5);
  for (const x of [-20, 16]) {
    ctx.beginPath();
    ctx.moveTo(x - 7, -24);
    ctx.lineTo(x + 7, -10);
    ctx.moveTo(x + 7, -24);
    ctx.lineTo(x - 7, -10);
    ink(ctx, 4);
  }
  if (t > TIMELINE.boom + 1) {
    const rise = easeOutBack(clamp01((t - TIMELINE.boom - 1) / 0.5));
    ctx.save();
    ctx.translate(40, -40);
    ctx.scale(1, rise);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -70);
    ink(ctx, 4);
    ctx.beginPath();
    ctx.moveTo(0, -70);
    for (let x = 0; x <= 42; x += 6) ctx.lineTo(x, -70 + Math.sin(x * 0.2 - t * 8) * 3);
    for (let x = 42; x >= 0; x -= 6) ctx.lineTo(x, -46 + Math.sin(x * 0.2 - t * 8) * 3);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ink(ctx, 3);
    ctx.restore();
  }
  ctx.restore();
}

function drawTrail(ctx: Ctx, trail: number[], color: string, width: number) {
  const count = trail.length / 2;
  if (count < 2) return;
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  for (let index = 1; index < count; index++) {
    const k = index / count;
    ctx.globalAlpha = k * 0.7;
    ctx.lineWidth = width * k;
    ctx.beginPath();
    ctx.moveTo(trail[(index - 1) * 2], trail[(index - 1) * 2 + 1]);
    ctx.lineTo(trail[index * 2], trail[index * 2 + 1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawGlyph(ctx: Ctx, p: Particle) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  switch (p.glyph) {
    case "table": {
      roundRect(ctx, -18, -14, 36, 28, 4);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.fillRect(-18, -14, 36, 8);
      ctx.beginPath();
      ctx.moveTo(-6, -6);
      ctx.lineTo(-6, 14);
      ctx.moveTo(6, -6);
      ctx.lineTo(6, 14);
      ctx.moveTo(-18, 4);
      ctx.lineTo(18, 4);
      ink(ctx, 2);
      roundRect(ctx, -18, -14, 36, 28, 4);
      ink(ctx, 3.5);
      return;
    }
    case "row": {
      roundRect(ctx, -24, -8, 48, 16, 8);
      ctx.fillStyle = p.color;
      ctx.fill();
      ink(ctx, 3.5);
      ctx.beginPath();
      for (const x of [-8, 8]) {
        ctx.moveTo(x, -8);
        ctx.lineTo(x, 8);
      }
      ink(ctx, 2);
      return;
    }
    case "json":
      ctx.font = `900 26px ${MONO}`;
      outlinedText(ctx, "{ }", 0, 0, p.color, 6);
      return;
    case "sql":
      roundRect(ctx, -28, -10, 56, 20, 5);
      ctx.fillStyle = p.color;
      ctx.fill();
      ink(ctx, 3);
      ctx.font = `900 12px ${MONO}`;
      ctx.fillStyle = INK;
      ctx.fillText("INSERT", 0, 1);
      return;
    case "bits":
      ctx.font = `900 18px ${MONO}`;
      outlinedText(ctx, "1010", 0, 0, p.color, 5);
      return;
  }
}

function drawHit(ctx: Ctx, p: Particle) {
  const k = p.age / p.life;
  const pop = easeOutBack(clamp01(k * 3));
  const scale = (p.crit ? 1.5 : 1) * pop;
  const inner = 7 * scale;
  const outer = 19 * scale;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = 1 - k * k;
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? INK : p.crit ? "#ff4d4d" : "#ffffff";
    ctx.lineWidth = pass === 0 ? 7 : 3.5;
    ctx.lineCap = "round";
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
  const scale = easeOutBack(clamp01(p.age / 0.18)) * p.size;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 1 - clamp01((k - 0.7) / 0.3);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (p.crit) {
    ctx.font = `italic 900 28px ${FONT}`;
    const width = ctx.measureText(p.text).width;
    ctx.beginPath();
    const spikes = 14;
    for (let index = 0; index <= spikes * 2; index++) {
      const angle = (index / (spikes * 2)) * Math.PI * 2;
      const radius = index % 2 === 0 ? 1 : 0.72;
      ctx.lineTo(Math.cos(angle) * (width / 2 + 22) * radius, Math.sin(angle) * 34 * radius);
    }
    ctx.closePath();
    ctx.fillStyle = "#ff5a3c";
    ctx.fill();
    ink(ctx, 4);
    outlinedText(ctx, p.text, 0, 2, "#f2e94e", 7);
  } else {
    ctx.font = `900 18px ${FONT}`;
    outlinedText(ctx, p.text, 0, 0, "#b6f05c", 5);
  }
  ctx.restore();
}

function drawSay(ctx: Ctx, p: Particle) {
  const k = p.age / p.life;
  const scale = easeOutBack(clamp01(p.age / 0.22));
  ctx.save();
  ctx.translate(p.x, p.y - k * 8);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 1 - clamp01((k - 0.85) / 0.15);
  ctx.font = `800 16px ${FONT}`;
  const width = ctx.measureText(p.text).width + 28;
  const left = p.x > STAGE_W / 2 ? -width + 30 : -30;
  ctx.beginPath();
  ctx.roundRect(left, -22, width, 40, 18);
  ctx.moveTo(-6, 16);
  ctx.lineTo(-14, 36);
  ctx.lineTo(10, 16);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ink(ctx, 3.5);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-8, 10, 20, 8);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(p.text, left + 14, -1);
  ctx.restore();
}

function drawMissile(ctx: Ctx, p: Particle, t: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(255,180,71,0.9)";
  ctx.beginPath();
  ctx.moveTo(-14, -5);
  ctx.lineTo(-30 - hash(Math.floor(t * 40) + p.tx) * 18, 0);
  ctx.lineTo(-14, 5);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.lineTo(10, -6);
  ctx.quadraticCurveTo(22, 0, 10, 6);
  ctx.lineTo(-14, 6);
  ctx.closePath();
  ctx.fillStyle = "#e9ecf2";
  ctx.fill();
  ink(ctx, 3);
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.lineTo(-20, -12);
  ctx.lineTo(-8, -6);
  ctx.moveTo(-14, 6);
  ctx.lineTo(-20, 12);
  ctx.lineTo(-8, 6);
  ctx.fillStyle = "#ff5a3c";
  ctx.fill();
  ink(ctx, 2.5);
  ctx.restore();
}

function drawParticle(ctx: Ctx, p: Particle, t: number) {
  const k = p.age / p.life;
  switch (p.kind) {
    case "smoke": {
      const tone = clamp01(p.age * 2);
      const shade = Math.round(250 - tone * 120);
      ctx.globalAlpha = 0.85 * (1 - k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${shade + 5}, ${shade - 10 + tone * 10}, ${shade - 30 + tone * 40})`;
      ctx.fill();
      ink(ctx, 2.5);
      ctx.globalAlpha = 1;
      return;
    }
    case "shot":
    case "debris": {
      if (p.trail)
        drawTrail(
          ctx,
          p.trail,
          p.kind === "shot" ? p.color : "rgba(255,255,255,0.5)",
          p.kind === "shot" ? 12 : 5,
        );
      const speed = Math.hypot(p.vx, p.vy);
      const heading = Math.atan2(p.vy, p.vx);
      const smear = Math.min(0.45, speed / 2400);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(heading);
      ctx.scale(1 + smear, 1 - smear * 0.4);
      ctx.rotate(p.rot - heading);
      if (p.kind === "shot") {
        ctx.scale(p.size, p.size);
        drawGlyph(ctx, p);
      } else {
        ctx.beginPath();
        ctx.moveTo(-p.size, -p.size * 0.6);
        ctx.lineTo(p.size * 0.8, -p.size * 0.8);
        ctx.lineTo(p.size, p.size * 0.5);
        ctx.lineTo(-p.size * 0.6, p.size * 0.7);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1 - clamp01((k - 0.8) / 0.2);
        ctx.fill();
        ink(ctx, 3);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    case "letter": {
      if (p.trail) drawTrail(ctx, p.trail, "#f2e94e", 10);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1.25, 1.25);
      ctx.font = `900 20px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      outlinedText(ctx, p.text, 0, 0, "#f2e94e", 6);
      ctx.restore();
      return;
    }
    case "missile":
      drawMissile(ctx, p, t);
      return;
    case "laser": {
      const width = 16 * (1 - k);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,77,109,0.75)";
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.tx, p.ty);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = width * 0.3;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,200,210,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 * (1 - k), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
    case "flake":
      if (p.trail) drawTrail(ctx, p.trail, p.color, p.size * 2);
      return;
    case "ring": {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 10 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * easeOutCubic(k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case "hit":
      drawHit(ctx, p);
      return;
    case "pop":
      drawPop(ctx, p);
      return;
    case "say":
      drawSay(ctx, p);
      return;
  }
}

function drawTag(ctx: Ctx, x: number, width: number, t: number, salt: number) {
  ctx.save();
  ctx.translate(x + boil(t, salt, 0.7), LABEL_Y + boil(t, salt + 1, 0.7));
  roundRect(ctx, -width / 2, -17, width, 34, 10);
  ctx.fillStyle = "#fffaf0";
  ctx.fill();
  ink(ctx, 4);
  ctx.restore();
}

function drawLabels(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  const name = scene.targetName;
  const width = Math.max(name.length, scene.sourceName.length) * 13 + 34;
  ctx.font = `900 20px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawTag(ctx, SOURCE_X, width, t, 41);
  if (scene.stolen === 0) {
    ctx.fillStyle = INK;
    ctx.fillText(scene.sourceName, SOURCE_X, LABEL_Y + 1);
  } else {
    const slots = nameSlots(name, SOURCE_X);
    ctx.fillStyle = "#3b7d1a";
    for (let index = 0; index < scene.stolen; index++)
      ctx.fillText(name[index], slots[index], LABEL_Y + 1);
    ctx.font = `800 13px ${MONO}`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(scene.sourceName, SOURCE_X, LABEL_Y - 30);
    const strike = ctx.measureText(scene.sourceName).width / 2 + 4;
    ctx.strokeStyle = "#ff4d4d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(SOURCE_X - strike, LABEL_Y - 28);
    ctx.lineTo(SOURCE_X + strike, LABEL_Y - 32);
    ctx.stroke();
  }
  if (!scene.destroyed) {
    drawTag(ctx, TARGET_X, width, t, 43);
    ctx.font = `900 20px ${MONO}`;
    if (scene.launched >= name.length) {
      ctx.fillStyle = "rgba(27,20,36,0.35)";
      ctx.fillText("???", TARGET_X, LABEL_Y + 1);
    } else {
      const slots = nameSlots(name, TARGET_X);
      ctx.fillStyle = INK;
      for (let index = scene.launched; index < name.length; index++)
        ctx.fillText(name[index], slots[index], LABEL_Y + 1);
    }
    const barW = 120;
    const hp = Math.max(0, scene.hp);
    roundRect(ctx, TARGET_X - barW / 2, LABEL_Y + 24, barW, 12, 6);
    ctx.fillStyle = "#3a1530";
    ctx.fill();
    roundRect(ctx, TARGET_X - barW / 2, LABEL_Y + 24, Math.max(10, barW * hp), 12, 6);
    ctx.fillStyle = hp > 0.6 ? "#7bd34f" : hp > 0.3 ? "#f2c94e" : "#ff4d4d";
    ctx.fill();
    roundRect(ctx, TARGET_X - barW / 2, LABEL_Y + 24, barW, 12, 6);
    ink(ctx, 3);
  }
}

function transferProgress(scene: Scene) {
  if (scene.destroyed) return 1;
  const letters = scene.stolen / Math.max(1, scene.targetName.length);
  return (
    letters * 0.8 + clamp01((scene.t - TIMELINE.arrival) / (TIMELINE.boom - TIMELINE.arrival)) * 0.2
  );
}

function drawHud(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  const progress = transferProgress(scene);
  const x = 24;
  const y = 22;
  const w = 260;
  ctx.font = `900 13px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  outlinedText(ctx, "TRANSFER", x, y, "#f2e94e", 4);
  roundRect(ctx, x, y + 12, w, 20, 10);
  ctx.fillStyle = "#2a1640";
  ctx.fill();
  ctx.save();
  roundRect(ctx, x, y + 12, Math.max(20, w * progress), 20, 10);
  ctx.clip();
  ctx.fillStyle = "#97ce4c";
  ctx.fillRect(x, y + 12, w, 20);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 7;
  const offset = (t * 40) % 22;
  for (let stripe = -22; stripe < w + 22; stripe += 22) {
    ctx.beginPath();
    ctx.moveTo(x + stripe + offset, y + 34);
    ctx.lineTo(x + stripe + offset + 14, y + 10);
    ctx.stroke();
  }
  ctx.restore();
  roundRect(ctx, x, y + 12, w, 20, 10);
  ink(ctx, 4);
  ctx.font = `900 12px ${MONO}`;
  ctx.textAlign = "right";
  outlinedText(ctx, `${Math.round(progress * 100)}%`, x + w - 8, y + 22, "#fff", 4);
  ctx.textAlign = "right";
  ctx.font = `900 24px ${MONO}`;
  outlinedText(ctx, scene.rows.toLocaleString("de-DE"), STAGE_W - 24, y + 6, "#b6f05c", 6);
  ctx.font = `900 11px ${FONT}`;
  outlinedText(ctx, "ZEILEN", STAGE_W - 24, y + 28, "#fff", 4);
}

function drawCinema(ctx: Ctx, t: number) {
  const bars =
    easeInOut(clamp01((t - TIMELINE.portal) / 0.8)) *
    (1 - easeInOut(clamp01((t - TIMELINE.outro - 1.2) / 0.8)));
  if (bars > 0) {
    ctx.fillStyle = "#07040d";
    ctx.fillRect(0, 0, STAGE_W, 44 * bars);
    ctx.fillRect(0, STAGE_H - 44 * bars, STAGE_W, 44 * bars);
  }
  if (t > TIMELINE.portal && t < TIMELINE.charge && Math.sin(t * 9) > -0.3) {
    ctx.save();
    ctx.translate(STAGE_W / 2, STAGE_H - 22 * bars);
    ctx.font = `italic 900 18px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    outlinedText(ctx, "⚠  FLAGGSCHIFF IM ANFLUG  ⚠", 0, 0, "#ff5a3c", 5);
    ctx.restore();
  }
  if (t > TIMELINE.outro + 1) {
    const k = easeOutBack(clamp01((t - TIMELINE.outro - 1) / 0.5));
    ctx.save();
    ctx.translate(STAGE_W / 2, STAGE_H - 74);
    ctx.rotate(-0.04);
    ctx.scale(k, k);
    ctx.font = `italic 900 38px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    outlinedText(ctx, "TRANSFER ABGESCHLOSSEN!", 0, 0, "#f2e94e", 9);
    ctx.restore();
  }
}

export function drawScene(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  const pose = shipPose(t);
  ctx.save();
  ctx.translate((Math.random() * 2 - 1) * scene.shake, (Math.random() * 2 - 1) * scene.shake);
  drawSky(ctx, t, pose);
  drawPortal(ctx, t);
  if (pose) {
    drawSpeedLines(ctx, pose, t);
    drawShip(ctx, pose, t);
    drawOrb(ctx, pose, t);
  }
  drawGround(ctx, t);
  for (const p of scene.particles)
    if (p.kind === "smoke" && p.y > GROUND - 60) drawParticle(ctx, p, t);
  drawSource(ctx, scene, pose);
  if (scene.destroyed) drawWreck(ctx, scene);
  else drawTarget(ctx, scene, pose);
  for (const p of scene.particles)
    if (p.kind === "smoke" && p.y <= GROUND - 60) drawParticle(ctx, p, t);
  for (const p of scene.particles)
    if (p.kind !== "smoke" && p.kind !== "pop" && p.kind !== "say" && p.kind !== "hit")
      drawParticle(ctx, p, t);
  drawBeam(ctx, pose, t);
  drawLabels(ctx, scene);
  for (const p of scene.particles)
    if (p.kind === "hit" || p.kind === "pop") drawParticle(ctx, p, t);
  for (const p of scene.particles) if (p.kind === "say") drawParticle(ctx, p, t);
  ctx.restore();
  drawCinema(ctx, t);
  drawHud(ctx, scene);
  if (scene.flash > 0.02) {
    ctx.fillStyle = `rgba(255, 255, 240, ${scene.flash})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
}
