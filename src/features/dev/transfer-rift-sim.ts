export const RIFT_CAP = 240;
export const RIFT_DURATION = 25;
export const riftJumps = [
  { label: "Transfer-Kanone", at: 0 },
  { label: "Dimensionsriss", at: 3.8 },
  { label: "Fremdschlüsselwelt", at: 6.6 },
  { label: "Familien-JOIN", at: 10.8 },
  { label: "Zeilenwurm", at: 14.1 },
  { label: "VACUUM", at: 16.4 },
  { label: "NULL", at: 21.5 },
  { label: "Zurück in der Garage", at: 23.5 },
];
export type Pose = { x: number; y: number; scale: number; angle: number };
type Key = readonly [number, number, number, number, number];
const SOURCE: Key[] = [
  [0, 235, 368, 1, 0],
  [1.5, 295, 368, 1, -0.12],
  [3, 270, 380, 1, -0.2],
  [3.7, 235, 368, 1, -0.15],
  [4.8, 510, 245, 0.6, 0.8],
  [6.3, 1310, 330, 1, -0.2],
  [7, 1370, 350, 1, 0],
  [8.3, 1520, 240, 1, 0.15],
  [9.4, 1635, 320, 1, 0],
  [10.4, 1495, 355, 1, -0.3],
  [11.4, 1405, 350, 1, -0.2],
  [12.8, 1350, 355, 1, -0.35],
  [14.1, 1390, 355, 1, 0],
  [16, 1400, 350, 1, 0],
  [18.8, 1380, 350, 1.15, -0.1],
  [19.8, 1350, 355, 1.2, -0.3],
  [21.2, 1170, 245, 0.05, -0.8],
  [22.9, 1170, 245, 0, 0],
  [23, 310, 350, 0, 0],
  [23.6, 310, 360, 1.2, 0],
  [25, 310, 360, 1.2, 0],
];
const TARGET: Key[] = [
  [0, 735, 368, 1, 0],
  [3.3, 725, 368, 1, 0.05],
  [4.8, 555, 240, 0.65, -0.7],
  [6.3, 1775, 335, 1, 0.3],
  [7, 1755, 350, 1, 0],
  [8.3, 1650, 245, 1, -0.2],
  [9.4, 1550, 320, 1, -0.3],
  [10.4, 1640, 355, 1, 0.2],
  [12.5, 1770, 350, 1, 0],
  [14, 1750, 350, 1, -0.1],
  [17, 1770, 350, 1, 0],
  [19.5, 1730, 350, 1, -0.2],
  [20.6, 1500, 270, 1, -0.3],
  [21.4, 1245, 320, 1, -0.8],
  [21.65, 1280, 369, 1, 0.25],
  [22.3, 1300, 370, 1, 0],
  [25, 1300, 370, 1, 0],
];
export function clamp(v: number) {
  return Math.max(0, Math.min(1, v));
}
export function smooth(v: number) {
  const k = clamp(v);
  return k * k * (3 - 2 * k);
}
export function mix(a: number, b: number, k: number) {
  return a + (b - a) * k;
}
export function poseAt(t: number, source: boolean, out: Pose) {
  const keys = source ? SOURCE : TARGET;
  let a = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b[0]) {
      const k = smooth((t - a[0]) / (b[0] - a[0]));
      out.x = mix(a[1], b[1], k);
      out.y = mix(a[2], b[2], k);
      out.scale = mix(a[3], b[3], k);
      out.angle = mix(a[4], b[4], k);
      return;
    }
    a = b;
  }
  out.x = a[1];
  out.y = a[2];
  out.scale = a[3];
  out.angle = a[4];
}
export type RiftParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
};
export type RiftScene = {
  t: number;
  clock: number;
  seed: number;
  sourceName: string;
  targetName: string;
  source: Pose;
  target: Pose;
  stolen: number;
  absorbed: number;
  rows: number;
  nextDust: number;
  event: number;
  freeze: number;
  shake: number;
  peak: number;
  particles: RiftParticle[];
  pool: RiftParticle[];
};
const EVENTS = [3.8, 6.3, 9.4, 12, 15.1, 16.7, 17.6, 18.5, 21.4];
function random(s: RiftScene) {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let v = s.seed;
  v = Math.imul(v ^ (v >>> 15), v | 1);
  v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
}
function burst(s: RiftScene, x: number, y: number, n: number, color: string) {
  for (let i = 0; i < n; i++) {
    const p = s.pool.pop();
    if (!p) break;
    const angle = random(s) * Math.PI * 2;
    const speed = 55 + random(s) * 260;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.age = 0;
    p.life = 0.4 + random(s) * 0.8;
    p.size = 2 + random(s) * 7;
    p.color = color;
    s.particles.push(p);
  }
  s.peak = Math.max(s.peak, s.particles.length);
}
export function createRiftScene(sourceName: string, targetName: string, seed = 7): RiftScene {
  const pose = () => ({ x: 0, y: 0, scale: 1, angle: 0 });
  const s: RiftScene = {
    t: 0,
    clock: 0,
    seed,
    sourceName,
    targetName,
    source: pose(),
    target: pose(),
    stolen: 0,
    absorbed: 0,
    rows: 0,
    nextDust: 3.8,
    event: 0,
    freeze: 0,
    shake: 0,
    peak: 0,
    particles: [],
    pool: Array.from({ length: RIFT_CAP }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      life: 1,
      size: 1,
      color: "",
    })),
  };
  poseAt(0, true, s.source);
  poseAt(0, false, s.target);
  return s;
}
export function letterProgress(s: RiftScene, i: number) {
  return clamp((s.t - 16 - (i / Math.max(1, s.targetName.length)) * 3.5) / 0.8);
}
export function stepRift(s: RiftScene, dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  s.clock += dt;
  s.shake *= Math.exp(-dt * 8);
  const paused = Math.min(dt, s.freeze);
  s.freeze -= paused;
  const elapsed = dt - paused;
  s.t = Math.min(RIFT_DURATION, s.t + elapsed);
  poseAt(s.t, true, s.source);
  poseAt(s.t, false, s.target);
  while (s.event < EVENTS.length && s.t >= EVENTS[s.event]) {
    const index = s.event++;
    s.freeze = 0.08;
    s.shake = index === 8 ? 15 : 10;
    burst(
      s,
      index === 0 ? 520 : index === 8 ? 1220 : s.source.x + 80,
      index === 0 ? 250 : 310,
      45,
      index === 4 ? "#c5f263" : "#ffdf63",
    );
  }
  while (s.nextDust <= Math.min(s.t, 20)) {
    if (s.nextDust < 6 || s.nextDust > 15.5)
      burst(s, s.source.x + 45, s.source.y - 40, 2, "#ff5ccf");
    s.nextDust += 0.07;
  }
  s.stolen = 0;
  for (let i = 0; i < s.targetName.length; i++) if (letterProgress(s, i) === 1) s.stolen++;
  s.absorbed = Number(s.t >= 17.1) + Number(s.t >= 18) + Number(s.t >= 18.9);
  s.rows = Math.floor(smooth((s.t - 16) / 4) * 1048576);
  let write = 0;
  for (const p of s.particles) {
    p.age += elapsed;
    if (p.age >= p.life) {
      s.pool.push(p);
      continue;
    }
    p.x += p.vx * elapsed;
    p.y += p.vy * elapsed + 95 * elapsed * elapsed;
    p.vy += 190 * elapsed;
    s.particles[write++] = p;
  }
  s.particles.length = write;
}
