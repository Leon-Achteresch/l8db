import {
  clamp01,
  easeInOut,
  easeOutCubic,
  GATE,
  GROUND,
  gateOpen,
  LABEL_Y,
  MUZZLE,
  nameSlots,
  type Particle,
  type Scene,
  SOURCE_X,
  type Speaker,
  STAGE_H,
  STAGE_W,
  SUBTITLES,
  shipOrb,
  shipPose,
  TARGET_X,
  TIMELINE,
} from "./transfer-cinematic-sim";

type Ctx = CanvasRenderingContext2D;
type Pose = NonNullable<ReturnType<typeof shipPose>>;
type Camera = { zoom: number; x: number; y: number };

const LINE = "#2b2633";
const UI = '"Inter", "SF Pro Text", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const SOURCE_SKIN = { body: "#a8e6cf", shade: "#7fc9ae", light: "#d9f7ea", top: "#c4f0dd" };
const TARGET_SKIN = { body: "#ffb199", shade: "#e98f78", light: "#ffd6c9", top: "#ffc5b3" };
const VOICE: Record<Speaker, string> = { source: "#a8e6cf", target: "#ffb199" };

const SHOTS: [number, number, number, number][] = [
  [0, 1.24, 480, 296],
  [TIMELINE.battle, 1, 480, 270],
  [TIMELINE.gate - 0.2, 1.04, 480, 280],
  [TIMELINE.arrival + 0.4, 0.94, 460, 234],
  [TIMELINE.charge, 0.94, 480, 230],
  [TIMELINE.barrage, 1.03, 580, 262],
  [TIMELINE.boom - 0.1, 1.1, 650, 300],
  [TIMELINE.boom + 0.15, 0.98, 610, 280],
  [TIMELINE.outro, 1, 520, 270],
  [TIMELINE.outro + 1.6, 1.12, 340, 300],
  [TIMELINE.done + 2, 1.12, 340, 300],
];

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

function line(ctx: Ctx, width = 2.2, color = LINE) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function nightAmount(t: number) {
  return clamp01((t - TIMELINE.arrival) / 1.6) * (1 - clamp01((t - TIMELINE.outro - 1.4) / 1.6));
}

const CLOUDS = Array.from({ length: 6 }, (_, index) => ({
  x: -200 + index * 260 + hash(index + 3) * 120,
  y: 40 + hash(index + 13) * 90,
  w: 90 + hash(index + 23) * 80,
}));

function drawSky(ctx: Ctx, t: number) {
  const sky = ctx.createLinearGradient(0, -200, 0, GROUND);
  sky.addColorStop(0, "#b9dfe4");
  sky.addColorStop(0.55, "#f3dcc4");
  sky.addColorStop(1, "#fbeadb");
  ctx.fillStyle = sky;
  ctx.fillRect(-400, -300, STAGE_W + 800, STAGE_H + 600);
  const sun = ctx.createRadialGradient(760, 70, 0, 760, 70, 260);
  sun.addColorStop(0, "rgba(255,255,240,0.85)");
  sun.addColorStop(1, "rgba(255,255,240,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(400, -200, 720, 520);
  ctx.fillStyle = "rgba(255,253,235,0.7)";
  for (const cloud of CLOUDS) {
    const x = cloud.x + ((t * 6) % 1300);
    const wrapped = x > 1250 ? x - 1550 : x;
    ctx.beginPath();
    ctx.ellipse(wrapped, cloud.y, cloud.w, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(wrapped + cloud.w * 0.3, cloud.y - 9, cloud.w * 0.45, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSpire(ctx: Ctx, x: number, base: number, height: number) {
  const top = base - height;
  ctx.beginPath();
  ctx.moveTo(x - 6, base);
  ctx.lineTo(x - 3, top + 30);
  ctx.lineTo(x, top);
  ctx.lineTo(x + 3, top + 30);
  ctx.lineTo(x + 6, base);
  ctx.closePath();
  ctx.fillStyle = "#c3b4d3";
  ctx.fill();
  line(ctx, 1.4, "#9b88ad");
  ctx.beginPath();
  ctx.ellipse(x, top + 46, 22, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#d4c7e1";
  ctx.fill();
  line(ctx, 1.4, "#9b88ad");
  ctx.beginPath();
  ctx.ellipse(x, top + 46, 22, 6, 0, 0.15, Math.PI - 0.15);
  ctx.strokeStyle = "#fff1c9";
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function drawTower(ctx: Ctx, x: number, base: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.lineTo(x - w / 2, base - h + w / 2);
  ctx.arc(x, base - h + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, base);
  ctx.closePath();
  ctx.fillStyle = "#cfc0de";
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#b9a8cb";
  ctx.fillRect(x + w * 0.15, base - h, w, h);
  ctx.restore();
  line(ctx, 1.4, "#9b88ad");
  ctx.fillStyle = "#fff1c9";
  for (let row = 0; row < Math.floor(h / 22) - 1; row++) {
    for (let column = 0; column < 2; column++) {
      ctx.fillRect(x - w / 4 + column * (w / 4) - 3, base - h + w / 2 + 12 + row * 22, 7, 10);
    }
  }
}

function drawFarCity(ctx: Ctx) {
  const base = GROUND - 40;
  ctx.fillStyle = "rgba(196, 184, 214, 0.5)";
  ctx.beginPath();
  ctx.moveTo(-400, base);
  for (let x = -400; x <= 1360; x += 80) ctx.lineTo(x, base - 80 - hash(x) * 70);
  ctx.lineTo(1360, base);
  ctx.closePath();
  ctx.fill();
  drawTower(ctx, -60, base, 54, 210);
  drawSpire(ctx, 70, base, 160);
  drawSpire(ctx, 120, base, 200);
  drawTower(ctx, 380, base, 40, 150);
  drawSpire(ctx, 470, base, 130);
  drawTower(ctx, 640, base, 62, 240);
  drawSpire(ctx, 840, base, 180);
  drawSpire(ctx, 890, base, 120);
  drawTower(ctx, 1020, base, 46, 180);
  ctx.fillStyle = "rgba(251, 234, 219, 0.38)";
  ctx.fillRect(-400, base - 300, 1800, 300);
}

function drawFoliage(ctx: Ctx, t: number) {
  const base = GROUND - 8;
  for (let index = 0; index < 16; index++) {
    const x = -300 + index * 105 + hash(index + 40) * 40;
    const r = 34 + hash(index + 50) * 30;
    const sway = Math.sin(t * 0.8 + index) * 2;
    ctx.beginPath();
    ctx.arc(x + sway, base - r * 0.6, r, Math.PI, 0);
    ctx.arc(x + r * 0.8 + sway, base - r * 0.3, r * 0.7, Math.PI, 0);
    ctx.lineTo(x + r * 1.5, base);
    ctx.lineTo(x - r, base);
    ctx.closePath();
    ctx.fillStyle = index % 3 === 0 ? "#a9c763" : "#98bb57";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#7fa246";
    ctx.beginPath();
    ctx.ellipse(x + r * 0.6, base, r * 1.4, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    line(ctx, 1.6, "#5d7a33");
  }
}

function drawGround(ctx: Ctx) {
  ctx.fillStyle = "#b9c3a4";
  ctx.fillRect(-500, GROUND - 6, 2000, 400);
  ctx.beginPath();
  ctx.moveTo(-500, GROUND - 6);
  ctx.lineTo(1500, GROUND - 6);
  line(ctx, 2);
  ctx.fillStyle = "#a6b192";
  ctx.fillRect(-500, GROUND + 34, 2000, 400);
  ctx.strokeStyle = "rgba(43,38,51,0.18)";
  ctx.lineWidth = 1.4;
  for (let x = -500; x < 1500; x += 70) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND - 6);
    ctx.lineTo(x - (x - STAGE_W / 2) * 0.35, GROUND + 140);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-500, GROUND + 34);
  ctx.lineTo(1500, GROUND + 34);
  ctx.stroke();
}

function drawGateBody(ctx: Ctx, t: number) {
  const open = gateOpen(t);
  if (open <= 0.01) return;
  ctx.save();
  ctx.translate(GATE.x, GATE.y);
  ctx.rotate(-0.12);
  const rx = 136;
  const ry = 158;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * open, ry * open, 0, 0, Math.PI * 2);
  const fill = ctx.createRadialGradient(0, 0, 4, 0, 0, ry);
  fill.addColorStop(0, "#f4f1ff");
  fill.addColorStop(0.35, "#b9aeff");
  fill.addColorStop(0.8, "#6f60e0");
  fill.addColorStop(1, "#3d3196");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let ring = 0; ring < 6; ring++) {
    const k = ((t * 0.7 + ring / 6) % 1) * open;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * k, ry * k, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(240,236,255,${0.5 * (1 - k)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + 10, ry + 10, 0, 0, Math.PI * 2);
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2, true);
  ctx.fillStyle = "#4b4f5d";
  ctx.fill("evenodd");
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + 10, ry + 10, 0, 0, Math.PI * 2);
  line(ctx, 2.2);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  line(ctx, 2.2);
  for (let segment = 0; segment < 12; segment++) {
    const angle = (segment / 12) * Math.PI * 2;
    const lit = (Math.floor(t * 8) + segment) % 12 < open * 12;
    ctx.save();
    ctx.translate(Math.cos(angle) * (rx + 5), Math.sin(angle) * (ry + 5));
    ctx.rotate(angle);
    ctx.fillStyle = lit ? "#cfc6ff" : "#2a2c36";
    ctx.fillRect(-3, -7, 6, 14);
    ctx.restore();
  }
  ctx.restore();
}

function drawGateGlow(ctx: Ctx, t: number) {
  const open = gateOpen(t);
  if (open <= 0.01) return;
  const glow = ctx.createRadialGradient(GATE.x, GATE.y, 20, GATE.x, GATE.y, 280 * open);
  glow.addColorStop(0, "rgba(160,140,255,0.4)");
  glow.addColorStop(1, "rgba(160,140,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(GATE.x - 290, GATE.y - 290, 580, 580);
}

function drawShip(ctx: Ctx, pose: Pose) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.tilt);
  ctx.scale(pose.scale, pose.scale);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = LINE;
  ctx.lineJoin = "round";
  for (const prong of [
    "M250 -34 L470 -58 L480 -50 L300 -12 Z",
    "M250 20 L462 40 L470 48 L300 8 Z",
  ]) {
    const path = new Path2D(prong);
    ctx.fillStyle = "#2f323d";
    ctx.fill(path);
    ctx.stroke(path);
  }
  const keel = new Path2D("M-250 44 L210 38 L170 74 L-210 80 Z");
  ctx.fillStyle = "#30333e";
  ctx.fill(keel);
  ctx.stroke(keel);
  const tower = new Path2D("M-270 -58 L-205 -102 L50 -110 L150 -64 Z");
  ctx.fillStyle = "#575c6c";
  ctx.fill(tower);
  ctx.stroke(tower);
  const bridge = new Path2D("M-130 -104 L-104 -140 L-24 -142 L2 -108 Z");
  ctx.fillStyle = "#62687a";
  ctx.fill(bridge);
  ctx.stroke(bridge);
  ctx.fillStyle = "#e9a94c";
  for (let index = 0; index < 5; index++) ctx.fillRect(-100 + index * 18, -128, 9, 4);
  const hull = new Path2D(
    "M-410 -8 L-360 -48 L-150 -72 L120 -66 L300 -40 L420 -8 L300 22 L120 44 L-150 54 L-360 34 Z",
  );
  ctx.fillStyle = "#4b4f5d";
  ctx.fill(hull);
  ctx.save();
  ctx.clip(hull);
  ctx.fillStyle = "#3a3d49";
  ctx.beginPath();
  ctx.moveTo(-420, 2);
  ctx.lineTo(430, -4);
  ctx.lineTo(430, 70);
  ctx.lineTo(-420, 70);
  ctx.fill();
  ctx.fillStyle = "#606678";
  ctx.beginPath();
  ctx.moveTo(-420, -40);
  ctx.lineTo(430, -30);
  ctx.lineTo(430, -80);
  ctx.lineTo(-420, -80);
  ctx.fill();
  ctx.strokeStyle = "rgba(30,28,38,0.55)";
  ctx.lineWidth = 1.2;
  for (const x of [-300, -220, -120, -20, 80, 180, 260]) {
    ctx.beginPath();
    ctx.moveTo(x, -80);
    ctx.lineTo(x + 14, 70);
    ctx.stroke();
  }
  ctx.strokeStyle = "#c9823a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-420, -14);
  ctx.lineTo(430, -20);
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = LINE;
  ctx.stroke(hull);
  for (const y of [-26, 0, 24]) {
    ctx.beginPath();
    ctx.ellipse(-404, y, 9, 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#24262f";
    ctx.fill();
    line(ctx, 2);
  }
  for (const x of [-210, 190]) {
    ctx.beginPath();
    ctx.roundRect(x - 18, 50, 36, 16, 4);
    ctx.fillStyle = "#4b4f5d";
    ctx.fill();
    line(ctx, 2);
    ctx.beginPath();
    ctx.roundRect(x - 5, 62, 10, 14, 2);
    ctx.fillStyle = "#24262f";
    ctx.fill();
    line(ctx, 2);
  }
  ctx.beginPath();
  ctx.ellipse(-10, 84, 46, 15, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#24262f";
  ctx.fill();
  line(ctx, 2.2);
  ctx.font = `700 14px ${UI}`;
  ctx.fillStyle = "#c9823a";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("L8-DB", -320, 18);
  ctx.restore();
}

function drawShipLights(ctx: Ctx, pose: Pose, t: number) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.tilt);
  ctx.scale(pose.scale, pose.scale);
  for (const y of [-26, 0, 24]) {
    const length = 60 + hash(Math.floor(t * 30) + y) * 30 + pose.speed * 140;
    const flame = ctx.createLinearGradient(-404, 0, -404 - length, 0);
    flame.addColorStop(0, "rgba(220,250,255,0.95)");
    flame.addColorStop(0.3, "rgba(110,210,255,0.7)");
    flame.addColorStop(1, "rgba(110,210,255,0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-404, y - 10);
    ctx.lineTo(-404 - length, y);
    ctx.lineTo(-404, y + 10);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,200,120,0.95)";
  for (let index = 0; index < 18; index++) {
    if (hash(index + Math.floor(t * 2)) < 0.2) continue;
    ctx.fillRect(-330 + index * 38, -32 + index * 0.4, 6, 3);
  }
  const blink = Math.sin(t * 5) > 0.6 ? 1 : 0.15;
  for (const [x, y] of [
    [-150, -72],
    [420, -8],
    [-360, 34],
  ]) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 18);
    glow.addColorStop(0, `rgba(255,90,80,${blink})`);
    glow.addColorStop(1, "rgba(255,90,80,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 18, y - 18, 36, 36);
  }
  ctx.restore();
}

function drawSpeedLines(ctx: Ctx, pose: Pose, t: number) {
  if (pose.speed < 0.1) return;
  ctx.strokeStyle = `rgba(255,255,255,${0.22 * pose.speed})`;
  ctx.lineCap = "round";
  for (let index = 0; index < 14; index++) {
    const y = pose.y + (hash(index + 801) - 0.5) * 240 * pose.scale;
    const length = (90 + hash(index + 901) * 180) * pose.speed;
    const offset = ((t * 1200 + hash(index + 1001) * 900) % 900) * pose.scale;
    const x = pose.x - 300 * pose.scale - offset;
    ctx.lineWidth = 1 + hash(index + 1101) * 1.5;
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
  const radius = (8 + 40 * grow * grow + Math.sin(t * 40) * 1.5) * fade;
  if (radius <= 0.5) return;
  const glow = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, radius * 3);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.25, "rgba(180,170,255,0.85)");
  glow.addColorStop(1, "rgba(110,210,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(orb.x, orb.y, radius * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(225,220,255,0.8)";
  ctx.lineWidth = 1.4;
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
  const width = (34 + 50 * envelope + Math.sin(t * 60) * 4) * envelope;
  const orb = shipOrb(pose);
  const angle = Math.atan2(GROUND - 70 - orb.y, TARGET_X - orb.x);
  const length = Math.hypot(GROUND - 70 - orb.y, TARGET_X - orb.x) + 90;
  ctx.save();
  ctx.translate(orb.x, orb.y);
  ctx.rotate(angle);
  for (const [scale, color] of [
    [1.9, "rgba(110,210,255,0.25)"],
    [1.1, "rgba(180,170,255,0.7)"],
    [0.4, "rgba(255,255,255,1)"],
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

function drawCylinder(ctx: Ctx, w: number, h: number, skin: typeof SOURCE_SKIN, flash: number) {
  const rx = w / 2;
  const ry = 16;
  const body = new Path2D();
  body.moveTo(-rx, -h);
  body.lineTo(-rx, 0);
  body.ellipse(0, 0, rx, ry, 0, Math.PI, 0, true);
  body.lineTo(rx, -h);
  body.ellipse(0, -h, rx, ry, 0, 0, Math.PI, false);
  body.closePath();
  ctx.fillStyle = skin.body;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = skin.shade;
  ctx.beginPath();
  ctx.moveTo(rx * 0.42, -h - 20);
  ctx.bezierCurveTo(rx * 0.3, -h * 0.6, rx * 0.36, -h * 0.25, rx * 0.5, 20);
  ctx.lineTo(rx + 4, 20);
  ctx.lineTo(rx + 4, -h - 20);
  ctx.fill();
  ctx.fillStyle = skin.light;
  ctx.beginPath();
  ctx.roundRect(-rx + 9, -h + 22, 6, h - 40, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(43,38,51,0.35)";
  ctx.lineWidth = 1.4;
  for (const level of [h / 3, (h * 2) / 3]) {
    ctx.beginPath();
    ctx.ellipse(0, -level, rx, ry, 0, 0, Math.PI, false);
    ctx.stroke();
  }
  if (flash > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`;
    ctx.fillRect(-rx - 4, -h - 20, w + 8, h + 40);
  }
  ctx.restore();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = LINE;
  ctx.lineJoin = "round";
  ctx.stroke(body);
  ctx.beginPath();
  ctx.ellipse(0, -h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.top;
  ctx.fill();
  line(ctx, 2.4);
}

function drawEye(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  lx: number,
  ly: number,
  pupil: number,
  lid = 0,
  lidColor = "#e98f78",
) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + lx * (r - pupil - 4), y + ly * (r - pupil - 4), pupil, 0, Math.PI * 2);
  ctx.fillStyle = LINE;
  ctx.fill();
  if (lid > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = lidColor;
    ctx.fillRect(x - r, y - r, r * 2, r * 2 * lid);
    ctx.beginPath();
    ctx.moveTo(x - r, y - r + r * 2 * lid);
    ctx.lineTo(x + r, y - r + r * 2 * lid);
    line(ctx, 2);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  line(ctx, 2);
}

function lookAt(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  return { lx: dx / length, ly: dy / length };
}

function speaking(t: number, speaker: Speaker) {
  for (const entry of SUBTITLES) {
    if (entry.speaker === speaker && t >= entry.from && t <= entry.to) {
      return Math.abs(Math.sin(t * 17)) * (0.6 + 0.4 * Math.abs(Math.sin(t * 5.3)));
    }
  }
  return 0;
}

function drawSource(ctx: Ctx, scene: Scene, pose: Pose | null) {
  const t = scene.t;
  const r = scene.recoil;
  const talk = speaking(t, "source");
  const cool = t > TIMELINE.outro + 0.3;
  ellipse(ctx, SOURCE_X, GROUND, 74, 11, "rgba(60,64,52,0.28)");
  ctx.save();
  ctx.translate(SOURCE_X - r * 4, GROUND);
  ctx.rotate(-0.025 * r);
  ctx.scale(1 + 0.03 * r, 1 - 0.03 * r + Math.sin(t * 2.4) * 0.008);
  ctx.beginPath();
  ctx.moveTo(10, -164);
  ctx.quadraticCurveTo(14, -186, 22, -198);
  line(ctx, 2.4);
  ellipse(ctx, 23, -200, 6, 6, Math.sin(t * 3) > 0 ? "#7fe3e0" : "#4fb3b0");
  ctx.beginPath();
  ctx.arc(23, -200, 6, 0, Math.PI * 2);
  line(ctx, 1.8);
  drawCylinder(ctx, 116, 150, SOURCE_SKIN, 0);
  const focus = pose && t < TIMELINE.boom + 0.6 ? shipOrb(pose) : { x: TARGET_X, y: GROUND - 90 };
  const { lx, ly } = lookAt(SOURCE_X, GROUND - 98, focus.x, focus.y);
  drawEye(ctx, -19, -100, 16, lx, ly, 2.4);
  drawEye(ctx, 15, -102, 14.5, lx, ly, 2.2);
  ctx.beginPath();
  ctx.moveTo(-32, -122);
  ctx.quadraticCurveTo(-20, -128, -8, -121);
  ctx.moveTo(4, -124);
  ctx.quadraticCurveTo(16, -130, 28, -125);
  line(ctx, 2.6);
  if (cool) {
    const slide = easeOutCubic(clamp01((t - TIMELINE.outro - 0.3) / 0.5));
    ctx.save();
    ctx.translate(0, -60 * (1 - slide));
    ctx.globalAlpha = slide;
    ctx.beginPath();
    ctx.moveTo(-42, -106);
    ctx.lineTo(36, -108);
    line(ctx, 3);
    for (const [x, w] of [
      [-19, 20],
      [15, 18],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x - w, -108);
      ctx.lineTo(x + w, -108);
      ctx.quadraticCurveTo(x + w, -88, x, -88);
      ctx.quadraticCurveTo(x - w, -88, x - w, -108);
      ctx.fillStyle = "#1b1920";
      ctx.fill();
      line(ctx, 1.6);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.55, -103);
      ctx.lineTo(x - w * 0.1, -103);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
  const open = Math.max(talk, r > 0.4 ? r * 0.6 : 0);
  ctx.beginPath();
  ctx.moveTo(-26, -60);
  ctx.quadraticCurveTo(-2, -64, 24, -66);
  ctx.quadraticCurveTo(4, -58 + 22 * open, -26, -60);
  ctx.closePath();
  ctx.fillStyle = "#5a2a35";
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#fff";
  ctx.fillRect(-30, -70, 60, 7);
  ctx.fillStyle = "#d9677a";
  ctx.beginPath();
  ctx.ellipse(0, -58 + 20 * open, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  line(ctx, 2);
  ctx.save();
  ctx.translate(50, -66);
  ctx.rotate(-0.06 - r * 0.18);
  ctx.translate(-r * 6, 0);
  ctx.beginPath();
  ctx.moveTo(-8, 4);
  ctx.lineTo(16, 0);
  line(ctx, 7);
  ctx.beginPath();
  ctx.moveTo(-8, 4);
  ctx.lineTo(16, 0);
  line(ctx, 4.5, "#c9ccd3");
  ctx.beginPath();
  ctx.roundRect(12, -10, 40, 18, 5);
  ctx.fillStyle = "#e6e8ec";
  ctx.fill();
  line(ctx, 2);
  ctx.beginPath();
  ctx.roundRect(48, -6, 10, 10, 3);
  ctx.fillStyle = "#7fe3e0";
  ctx.fill();
  line(ctx, 1.8);
  ctx.beginPath();
  ctx.arc(28, -10, 6, Math.PI, 0);
  ctx.fillStyle = "#3f4552";
  ctx.fill();
  line(ctx, 1.8);
  ctx.restore();
  ctx.restore();
}

function drawTarget(ctx: Ctx, scene: Scene, pose: Pose | null) {
  const t = scene.t;
  const f = scene.flinch;
  const panic = pose ? 1 : 0;
  const talk = speaking(t, "target");
  const tremble = Math.sin(t * 46) * (0.6 + panic * 1.6);
  ellipse(ctx, TARGET_X, GROUND, 70, 11, "rgba(60,64,52,0.28)");
  ctx.save();
  ctx.translate(TARGET_X + f * 9 + tremble, GROUND);
  ctx.rotate(0.06 * f);
  ctx.scale(1 - 0.04 * f, 1 + 0.03 * f + Math.sin(t * 2.6 + 1) * 0.008);
  for (const side of [-1, 1]) {
    const wave = Math.sin(t * (4 + panic * 9) + side) * (0.25 + panic * 0.35);
    const hand = { x: side * (74 + wave * 6), y: -60 - panic * 50 + wave * 18 };
    for (const [width, color] of [
      [7, LINE],
      [4.5, "#c9ccd3"],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(side * 54, -74);
      ctx.quadraticCurveTo(side * 74, -76, hand.x, hand.y);
      line(ctx, width, color);
    }
    ellipse(ctx, hand.x, hand.y, 6, 6, "#c9ccd3");
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 6, 0, Math.PI * 2);
    line(ctx, 1.8);
  }
  drawCylinder(ctx, 112, 144, TARGET_SKIN, f > 0.5 ? f : 0);
  ctx.beginPath();
  ctx.moveTo(-8, -158);
  ctx.quadraticCurveTo(-16, -176, -30, -180);
  line(ctx, 2.4);
  ellipse(ctx, -32, -180, 5, 5, panic && Math.sin(t * 20) > 0 ? "#ff5a5a" : "#ffd6c9");
  ctx.beginPath();
  ctx.arc(-32, -180, 5, 0, Math.PI * 2);
  line(ctx, 1.8);
  const damage = 1 - scene.hp;
  ctx.strokeStyle = "rgba(43,38,51,0.7)";
  ctx.lineWidth = 1.4;
  const cracks = [
    [-34, -112, -24, -100, -30, -88, -18, -78],
    [32, -126, 22, -112, 30, -100],
    [-40, -48, -28, -42, -32, -30],
    [20, -56, 32, -46, 26, -34, 36, -22],
  ];
  for (let index = 0; index < Math.min(cracks.length, Math.floor(damage * 5)); index++) {
    const crack = cracks[index];
    ctx.beginPath();
    ctx.moveTo(crack[0], crack[1]);
    for (let point = 2; point < crack.length; point += 2)
      ctx.lineTo(crack[point], crack[point + 1]);
    ctx.stroke();
  }
  if (damage > 0.3) {
    ctx.fillStyle = `rgba(70,50,30,${Math.min(0.35, damage * 0.4)})`;
    ctx.beginPath();
    ctx.ellipse(-26, -40, 16, 10, 0.4, 0, Math.PI * 2);
    ctx.ellipse(30, -110, 12, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  const focus = pose ? { x: pose.x, y: pose.y } : { x: SOURCE_X, y: GROUND - 100 };
  const look = lookAt(TARGET_X, GROUND - 96, focus.x, focus.y);
  const squint = f > 0.55;
  const eyeR = pose ? 18 : 16;
  const pupil = pose ? 1.8 : 2.4;
  const lid = squint ? 0.5 : 0;
  drawEye(ctx, -19, -96, eyeR, look.lx, look.ly, pupil, lid);
  drawEye(ctx, 17, -96, eyeR - 1, look.lx, look.ly, pupil, lid);
  ctx.beginPath();
  ctx.moveTo(-36, -120 - panic * 4);
  ctx.quadraticCurveTo(-24, -126 - panic * 6, -8, -122);
  ctx.moveTo(34, -120 - panic * 4);
  ctx.quadraticCurveTo(24, -126 - panic * 6, 8, -122);
  line(ctx, 2.2);
  const open = Math.max(talk, panic * 0.5, squint ? 0.6 : 0);
  if (open > 0.05) {
    ctx.beginPath();
    ctx.moveTo(-16, -56);
    ctx.quadraticCurveTo(0, -60, 16, -56);
    ctx.quadraticCurveTo(0, -56 + 20 * open, -16, -56);
    ctx.closePath();
    ctx.fillStyle = "#5a2a35";
    ctx.fill();
    line(ctx, 2);
  } else {
    ctx.beginPath();
    ctx.moveTo(-14, -56);
    ctx.bezierCurveTo(-6, -60, 4, -52, 14, -57);
    line(ctx, 2);
  }
  if (panic) {
    const phase = (t * 0.9) % 1;
    const x = 44;
    const y = -124 + phase * 40;
    ctx.globalAlpha = 1 - phase;
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.quadraticCurveTo(x + 6, y + 2, x, y + 4);
    ctx.quadraticCurveTo(x - 6, y + 2, x, y - 9);
    ctx.fillStyle = "#c8ecf7";
    ctx.fill();
    line(ctx, 1.4);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawWreck(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  ellipse(ctx, TARGET_X, GROUND + 2, 110, 16, "rgba(40,36,30,0.45)");
  ctx.save();
  ctx.translate(TARGET_X, GROUND);
  const shell = new Path2D(
    "M-56 0 L-56 -34 L-44 -50 L-30 -32 L-16 -56 L2 -36 L18 -50 L34 -30 L48 -44 L56 -30 L56 0 A56 16 0 0 1 -56 0 Z",
  );
  ctx.fillStyle = "#b97a68";
  ctx.fill(shell);
  ctx.save();
  ctx.clip(shell);
  ctx.fillStyle = "#8a5848";
  ctx.fillRect(18, -60, 50, 80);
  ctx.fillStyle = "rgba(40,30,20,0.5)";
  ctx.fillRect(-60, -60, 120, 18);
  ctx.restore();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = LINE;
  ctx.lineJoin = "round";
  ctx.stroke(shell);
  for (const x of [-18, 16]) {
    ctx.beginPath();
    ctx.moveTo(x - 5, -24);
    ctx.lineTo(x + 5, -14);
    ctx.moveTo(x + 5, -24);
    ctx.lineTo(x - 5, -14);
    line(ctx, 2);
  }
  if (t > TIMELINE.boom + 1.2) {
    const rise = easeOutCubic(clamp01((t - TIMELINE.boom - 1.2) / 0.6));
    ctx.save();
    ctx.translate(34, -36);
    ctx.scale(1, rise);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -64);
    line(ctx, 2.2);
    ctx.beginPath();
    ctx.moveTo(0, -64);
    for (let x = 0; x <= 36; x += 6) ctx.lineTo(x, -64 + Math.sin(x * 0.2 - t * 5) * 2.5);
    for (let x = 36; x >= 0; x -= 6) ctx.lineTo(x, -44 + Math.sin(x * 0.2 - t * 5) * 2.5);
    ctx.closePath();
    ctx.fillStyle = "#fbfbf7";
    ctx.fill();
    line(ctx, 1.8);
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
    ctx.globalAlpha = k * k * 0.55;
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
      ctx.beginPath();
      ctx.roundRect(-16, -12, 32, 24, 3);
      ctx.fillStyle = "#fbfbf7";
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.fillRect(-16, -12, 32, 6);
      ctx.beginPath();
      ctx.moveTo(-5, -6);
      ctx.lineTo(-5, 12);
      ctx.moveTo(6, -6);
      ctx.lineTo(6, 12);
      ctx.moveTo(-16, 3);
      ctx.lineTo(16, 3);
      line(ctx, 1.1, "rgba(43,38,51,0.6)");
      ctx.beginPath();
      ctx.roundRect(-16, -12, 32, 24, 3);
      line(ctx, 1.8);
      return;
    }
    case "row": {
      ctx.beginPath();
      ctx.roundRect(-22, -7, 44, 14, 7);
      ctx.fillStyle = p.color;
      ctx.fill();
      line(ctx, 1.8);
      ctx.beginPath();
      for (const x of [-7, 7]) {
        ctx.moveTo(x, -7);
        ctx.lineTo(x, 7);
      }
      line(ctx, 1.1, "rgba(43,38,51,0.6)");
      return;
    }
    case "json":
      ctx.font = `700 20px ${MONO}`;
      ctx.fillStyle = p.color;
      ctx.fillText("{ }", 0, 0);
      return;
    case "sql":
      ctx.beginPath();
      ctx.roundRect(-25, -9, 50, 18, 4);
      ctx.fillStyle = "#2f2b3a";
      ctx.fill();
      ctx.font = `700 10px ${MONO}`;
      ctx.fillStyle = p.color;
      ctx.fillText("INSERT", 0, 1);
      return;
    case "bits":
      ctx.font = `700 15px ${MONO}`;
      ctx.fillStyle = p.color;
      ctx.fillText("1010", 0, 0);
      return;
  }
}

function drawSolidParticle(ctx: Ctx, p: Particle) {
  const k = p.age / p.life;
  if (p.kind === "smoke") {
    ctx.globalAlpha = 0.8 * (1 - k);
    ellipse(ctx, p.x, p.y, p.size, p.size, p.age < 0.4 ? "#8c8291" : "#77727f");
    ellipse(ctx, p.x - p.size * 0.28, p.y - p.size * 0.3, p.size * 0.62, p.size * 0.6, "#9d97a6");
    ctx.globalAlpha = 1;
    return;
  }
  if (p.kind === "debris") {
    if (p.trail) drawTrail(ctx, p.trail, "rgba(255,255,255,0.6)", 3);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = 1 - clamp01((k - 0.8) / 0.2);
    ctx.beginPath();
    ctx.moveTo(-p.size, -p.size * 0.6);
    ctx.lineTo(p.size * 0.8, -p.size * 0.8);
    ctx.lineTo(p.size, p.size * 0.5);
    ctx.lineTo(-p.size * 0.6, p.size * 0.7);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    line(ctx, 1.6);
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }
  if (p.kind === "letter") {
    if (p.trail) drawTrail(ctx, p.trail, "rgba(43,38,51,0.35)", 6);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot * 0.3);
    ctx.beginPath();
    ctx.roundRect(-10, -12, 20, 24, 6);
    ctx.fillStyle = "rgba(24,22,32,0.85)";
    ctx.fill();
    ctx.font = `600 14px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#a8f0e8";
    ctx.fillText(p.text, 0, 1);
    ctx.restore();
    return;
  }
  if (p.kind === "shot") {
    if (p.trail) drawTrail(ctx, p.trail, p.color, 7);
    const speed = Math.hypot(p.vx, p.vy);
    const heading = Math.atan2(p.vy, p.vx);
    const smear = Math.min(0.35, speed / 2600);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(heading);
    ctx.scale(1 + smear, 1 - smear * 0.35);
    ctx.rotate(p.rot - heading);
    ctx.scale(p.size, p.size);
    drawGlyph(ctx, p);
    ctx.restore();
    return;
  }
  if (p.kind === "missile") {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.beginPath();
    ctx.moveTo(-12, -4);
    ctx.lineTo(8, -4);
    ctx.quadraticCurveTo(18, 0, 8, 4);
    ctx.lineTo(-12, 4);
    ctx.closePath();
    ctx.fillStyle = "#d9dbe2";
    ctx.fill();
    line(ctx, 1.6);
    ctx.beginPath();
    ctx.moveTo(-12, -4);
    ctx.lineTo(-17, -9);
    ctx.lineTo(-7, -4);
    ctx.moveTo(-12, 4);
    ctx.lineTo(-17, 9);
    ctx.lineTo(-7, 4);
    ctx.fillStyle = "#c9823a";
    ctx.fill();
    line(ctx, 1.4);
    ctx.restore();
  }
}

function drawLightParticle(ctx: Ctx, p: Particle, t: number) {
  const k = p.age / p.life;
  switch (p.kind) {
    case "missile": {
      const flame = 16 + hash(Math.floor(t * 40) + p.tx) * 12;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const glow = ctx.createLinearGradient(-12, 0, -12 - flame, 0);
      glow.addColorStop(0, "rgba(255,230,170,1)");
      glow.addColorStop(1, "rgba(255,140,60,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo(-12, -4);
      ctx.lineTo(-12 - flame, 0);
      ctx.lineTo(-12, 4);
      ctx.fill();
      ctx.restore();
      return;
    }
    case "laser": {
      const width = 12 * (1 - k);
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,90,110,0.7)";
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.tx, p.ty);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,240,245,0.95)";
      ctx.lineWidth = width * 0.3;
      ctx.stroke();
      return;
    }
    case "spark": {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case "fire": {
      const radius = p.size * (1 - k * 0.5);
      const heat = 1 - k;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      glow.addColorStop(0, `rgba(255,250,220,${heat})`);
      glow.addColorStop(0.4, `rgba(255,180,80,${heat * 0.8})`);
      glow.addColorStop(1, "rgba(220,70,40,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "flake":
      if (p.trail) drawTrail(ctx, p.trail, p.color, p.size * 2);
      return;
    case "ring": {
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 6 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * easeOutCubic(k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
  }
}

function drawHit(ctx: Ctx, p: Particle) {
  const k = p.age / p.life;
  const pop = 1 + (1 - clamp01(k * 4)) * 0.35;
  const scale = (p.crit ? 1.25 : 1) * pop;
  const inner = 6 * scale;
  const outer = 14 * scale;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = 1 - k * k;
  ctx.lineCap = "round";
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? "rgba(20,18,26,0.55)" : p.crit ? "#ff6b6b" : "#ffffff";
    ctx.lineWidth = pass === 0 ? 4 : 2;
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
  ctx.font = `600 12px ${UI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(20,18,26,0.6)";
  ctx.fillText(p.text, p.x + 1, p.y + 1);
  ctx.fillStyle = "#d8fbff";
  ctx.fillText(p.text, p.x, p.y);
  ctx.globalAlpha = 1;
}

function pill(ctx: Ctx, x: number, y: number, width: number, height: number) {
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
  ctx.fillStyle = "rgba(24,22,32,0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLabels(ctx: Ctx, scene: Scene) {
  const name = scene.targetName;
  const width = Math.max(name.length, scene.sourceName.length) * 11 + 28;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  pill(ctx, SOURCE_X, LABEL_Y, width, 26);
  ctx.font = `600 14px ${MONO}`;
  if (scene.stolen === 0) {
    ctx.fillStyle = "#f4f2f8";
    ctx.fillText(scene.sourceName, SOURCE_X, LABEL_Y + 1);
  } else {
    const slots = nameSlots(name, SOURCE_X);
    ctx.fillStyle = "#a8f0e8";
    for (let index = 0; index < scene.stolen; index++)
      ctx.fillText(name[index], slots[index], LABEL_Y + 1);
    ctx.font = `500 10px ${MONO}`;
    ctx.fillStyle = "rgba(43,38,51,0.6)";
    ctx.fillText(scene.sourceName, SOURCE_X, LABEL_Y - 22);
    const strike = ctx.measureText(scene.sourceName).width / 2 + 3;
    ctx.strokeStyle = "rgba(200,60,60,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(SOURCE_X - strike, LABEL_Y - 22);
    ctx.lineTo(SOURCE_X + strike, LABEL_Y - 22);
    ctx.stroke();
  }
  if (scene.destroyed) return;
  pill(ctx, TARGET_X, LABEL_Y, width, 26);
  ctx.font = `600 14px ${MONO}`;
  if (scene.launched >= name.length) {
    ctx.fillStyle = "rgba(244,242,248,0.35)";
    ctx.fillText("—", TARGET_X, LABEL_Y + 1);
  } else {
    const slots = nameSlots(name, TARGET_X);
    ctx.fillStyle = "#f4f2f8";
    for (let index = scene.launched; index < name.length; index++)
      ctx.fillText(name[index], slots[index], LABEL_Y + 1);
  }
  const barW = 90;
  const hp = Math.max(0, scene.hp);
  ctx.beginPath();
  ctx.roundRect(TARGET_X - barW / 2, LABEL_Y + 20, barW, 4, 2);
  ctx.fillStyle = "rgba(24,22,32,0.45)";
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(TARGET_X - barW / 2, LABEL_Y + 20, Math.max(4, barW * hp), 4, 2);
  ctx.fillStyle = hp > 0.6 ? "#5fd4a8" : hp > 0.3 ? "#f0c24a" : "#ef5a5a";
  ctx.fill();
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
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.font = `600 10px ${UI}`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "left";
  ctx.fillText("TRANSFER", x, y);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(progress * 100)} %`, x + w, y);
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.roundRect(x, y + 10, w, 3, 1.5);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, y + 10, Math.max(3, w * progress), 3, 1.5);
  ctx.fillStyle = "#7fe3e0";
  ctx.fill();
  ctx.shadowBlur = 4;
  ctx.textAlign = "right";
  ctx.font = `600 18px ${MONO}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(scene.rows.toLocaleString("de-DE"), STAGE_W - 28, y + 2);
  ctx.font = `600 9px ${UI}`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("ZEILEN ÜBERTRAGEN", STAGE_W - 28, y + 18);
  ctx.shadowBlur = 0;
}

function drawSubtitle(ctx: Ctx, scene: Scene, bars: number) {
  const t = scene.t;
  const active = SUBTITLES.find((entry) => t >= entry.from && t <= entry.to);
  if (!active) return;
  const alpha = Math.min(clamp01((t - active.from) / 0.2), clamp01((active.to - t) / 0.25));
  const name = active.speaker === "source" ? scene.sourceName : scene.targetName;
  const y = STAGE_H - 22 - (1 - bars) * 18;
  ctx.globalAlpha = alpha;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `500 15px ${UI}`;
  const textWidth = ctx.measureText(active.text).width;
  ctx.font = `600 11px ${MONO}`;
  const nameWidth = ctx.measureText(name).width + 10;
  const left = STAGE_W / 2 - (textWidth + nameWidth) / 2;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = VOICE[active.speaker];
  ctx.fillText(name, left, y + 1);
  ctx.font = `500 15px ${UI}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(active.text, left + nameWidth, y);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawTitle(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  if (t < TIMELINE.outro + 1.6) return;
  const k = easeOutCubic(clamp01((t - TIMELINE.outro - 1.6) / 0.9));
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(STAGE_W / 2 + 140, 200 + (1 - k) * 12);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 11px ${UI}`;
  ctx.fillStyle = "rgba(43,38,51,0.7)";
  ctx.fillText("TRANSFER ABGESCHLOSSEN", 0, -30);
  ctx.font = `700 34px ${UI}`;
  ctx.fillStyle = LINE;
  ctx.fillText(scene.targetName, 0, 4);
  ctx.font = `500 13px ${MONO}`;
  ctx.fillStyle = "rgba(43,38,51,0.75)";
  ctx.fillText(`${scene.rows.toLocaleString("de-DE")} Zeilen`, 0, 34);
  ctx.fillStyle = "#3fb6b0";
  ctx.fillRect(0, -16, 40 * k, 2);
  ctx.restore();
}

export function drawScene(ctx: Ctx, scene: Scene) {
  const t = scene.t;
  const pose = shipPose(t);
  const cam = camera(t);
  const shakeX = (Math.random() * 2 - 1) * scene.shake;
  const shakeY = (Math.random() * 2 - 1) * scene.shake;
  const night = nightAmount(t);

  ctx.save();
  ctx.translate(shakeX, shakeY);
  enterLayer(ctx, cam, 0.05);
  drawSky(ctx, t);
  ctx.restore();
  enterLayer(ctx, cam, 0.3);
  drawFarCity(ctx);
  ctx.restore();
  enterLayer(ctx, cam, 1);
  drawGateBody(ctx, t);
  if (pose) {
    drawSpeedLines(ctx, pose, t);
    drawShip(ctx, pose);
  }
  ctx.restore();
  enterLayer(ctx, cam, 0.65);
  drawFoliage(ctx, t);
  ctx.restore();
  enterLayer(ctx, cam, 1);
  drawGround(ctx);
  for (const p of scene.particles) {
    if (p.kind === "smoke" && p.y > GROUND - 70) drawSolidParticle(ctx, p);
  }
  drawSource(ctx, scene, pose);
  if (scene.destroyed) drawWreck(ctx, scene);
  else drawTarget(ctx, scene, pose);
  for (const p of scene.particles) {
    if (p.kind !== "smoke") drawSolidParticle(ctx, p);
  }
  for (const p of scene.particles) {
    if (p.kind === "smoke" && p.y <= GROUND - 70) drawSolidParticle(ctx, p);
  }
  ctx.restore();
  ctx.restore();

  if (night > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgba(112, 108, 160, ${0.48 * night})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.restore();
  }
  if (t > TIMELINE.charge && t < TIMELINE.boom) {
    ctx.fillStyle = `rgba(255, 60, 70, ${0.05 + 0.04 * Math.sin(t * 10)})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);
  enterLayer(ctx, cam, 1);
  ctx.globalCompositeOperation = "lighter";
  drawGateGlow(ctx, t);
  if (pose) {
    drawShipLights(ctx, pose, t);
    drawOrb(ctx, pose, t);
  }
  if (scene.recoil > 0.25) {
    const radius = 30 * scene.recoil;
    const flash = ctx.createRadialGradient(MUZZLE.x, MUZZLE.y, 0, MUZZLE.x, MUZZLE.y, radius);
    flash.addColorStop(0, "rgba(210,250,250,0.9)");
    flash.addColorStop(1, "rgba(127,227,224,0)");
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(MUZZLE.x, MUZZLE.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of scene.particles) drawLightParticle(ctx, p, t);
  drawBeam(ctx, pose, t);
  if (scene.flash > 0.02) {
    const glow = ctx.createRadialGradient(TARGET_X, GROUND - 70, 0, TARGET_X, GROUND - 70, 520);
    glow.addColorStop(0, `rgba(255,220,160,${0.9 * scene.flash})`);
    glow.addColorStop(1, "rgba(255,160,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(TARGET_X - 600, GROUND - 640, 1200, 1200);
  }
  ctx.globalCompositeOperation = "source-over";
  drawLabels(ctx, scene);
  for (const p of scene.particles) {
    if (p.kind === "hit") drawHit(ctx, p);
    else if (p.kind === "pop") drawPop(ctx, p);
  }
  ctx.restore();
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    STAGE_W / 2,
    STAGE_H / 2,
    STAGE_H * 0.45,
    STAGE_W / 2,
    STAGE_H / 2,
    STAGE_W * 0.7,
  );
  vignette.addColorStop(0, "rgba(20,16,30,0)");
  vignette.addColorStop(1, `rgba(20,16,30,${0.28 + night * 0.25})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const bars =
    easeInOut(clamp01((t - TIMELINE.gate) / 0.8)) *
    (1 - easeInOut(clamp01((t - TIMELINE.outro - 1.2) / 0.8)));
  if (bars > 0) {
    ctx.fillStyle = "#0b0910";
    ctx.fillRect(0, 0, STAGE_W, 46 * bars);
    ctx.fillRect(0, STAGE_H - 46 * bars, STAGE_W, 46 * bars);
  }
  drawTitle(ctx, scene);
  drawHud(ctx, scene);
  drawSubtitle(ctx, scene, bars);
  if (scene.flash > 0.02) {
    ctx.fillStyle = `rgba(255, 252, 240, ${scene.flash * 0.85})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
}
