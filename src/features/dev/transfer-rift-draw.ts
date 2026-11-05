import type { CinematicVariant } from "./transfer-cinematic-variant";
import {
  clamp,
  createRiftScene,
  letterProgress,
  mix,
  RIFT_DURATION,
  type RiftScene,
  riftJumps,
  smooth,
  stepRift,
} from "./transfer-rift-sim";

type Ctx = CanvasRenderingContext2D;
const INK = "#241e36";
const CREAM = "#fff3ca";
function path(c: Ctx, points: number[], fill?: string, stroke = INK, width = 4) {
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  if (fill) {
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }
  c.strokeStyle = stroke;
  c.lineWidth = width;
  c.stroke();
}
function oval(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string, width = 3) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = width;
  c.strokeStyle = INK;
  if (width) c.stroke();
}
function box(c: Ctx, x: number, y: number, w: number, h: number, fill: string, radius = 5) {
  c.beginPath();
  c.roundRect(x, y, w, h, radius);
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.stroke();
}
function text(c: Ctx, value: string, x: number, y: number, size = 16, color = CREAM) {
  c.font = `bold ${size}px ui-monospace, monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = color;
  c.fillText(value, x, y);
}
function tear(c: Ctx, x: number, y: number, scale: number, t: number) {
  if (scale <= 0) return;
  const jitter = Math.sin(Math.floor(t * 12) * 7) * 5;
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  const points = [
    0, -145, 24, -97, 12, -65, 53, -28, 31, 8, 47, 50, 16, 80, 8, 146, -22, 94, -14, 52, -51, 21,
    -30, -19, -43, -63, -13, -89,
  ];
  path(c, points, "#2a143f", "#ff42cf", 15);
  path(c, points, undefined, "#ffe56f", 4);
  path(c, [-8, -108, 13 + jitter, -60, -8, -25, 18, 15, -10, 68, 4, 110], undefined, "#ff8cdc", 3);
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? -1 : 1;
    const yy = -80 + i * 49;
    path(
      c,
      [side * 35, yy, side * (65 + jitter), yy - 12, side * 57, yy + 8, side * 85, yy + 15],
      undefined,
      "#ffdc64",
      3,
    );
  }
  c.restore();
}
function character(
  c: Ctx,
  x: number,
  y: number,
  scale: number,
  angle: number,
  mint: boolean,
  t: number,
  mode = 0,
) {
  if (scale < 0.01) return;
  const run = t > 6.6 && t < 13.5;
  const stride = run ? Math.sin(t * 17 + (mint ? 0 : 2)) * 22 : Math.sin(t * 2) * 2;
  const boil = Math.sin(Math.floor(t * 8) * 1.7) * 1.2;
  const squash = 1 + Math.sin(t * (run ? 17 : 3)) * (run ? 0.055 : 0.018);
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.scale(scale / squash, scale * squash);
  oval(c, 0, 48, 55, 8, "#241e3633", 0);
  path(c, [-24, 18, -30 - stride, 41, -46 - stride, 42], undefined, INK, 8);
  path(c, [24, 18, 30 + stride, 41, 45 + stride, 42], undefined, INK, 8);
  const punch = !mint && t > 8.8 && t < 10.2 ? Math.sin(clamp((t - 8.8) / 1.4) * Math.PI) * 65 : 0;
  path(c, [-47, -45, -65, -20 - stride, -82, -38], undefined, INK, mode === 2 ? 19 : 7);
  path(
    c,
    [47, -45, 66 + punch, -63 + stride, 83 + punch, -58 + stride],
    undefined,
    INK,
    mode === 2 ? 19 : 7,
  );
  oval(c, -82, -38, mode === 2 ? 17 : 9, 10, mint ? "#8fe4cf" : "#ffa88c");
  oval(c, 83 + punch, -58 + stride, 10, 10, mint ? "#8fe4cf" : "#ffa88c");
  c.beginPath();
  c.moveTo(-49, -90);
  c.bezierCurveTo(-52 + boil, -35, -50, 12, -46, 17);
  c.bezierCurveTo(-20, 37, 24, 34, 48, 16);
  c.lineTo(49, -90);
  c.closePath();
  c.fillStyle = mint ? "#8fe4cf" : "#ffa88c";
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.stroke();
  path(c, [26, -79, 46, -85, 45, 13, 27, 22], mint ? "#51b5aa" : "#d77787", INK, 0.5);
  for (let i = 0; i < 2; i++) {
    c.beginPath();
    c.moveTo(-49, -40 + i * 29);
    c.quadraticCurveTo(0, -16 + i * 29, 48, -40 + i * 29);
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.stroke();
  }
  oval(c, 0, -90, 49, 17, mint ? "#c1f7da" : "#ffd2a3", 4);
  oval(c, -20, -58, 17, 22, "#fffdf2");
  oval(c, 17, -61, 18, 22, "#fffdf2");
  oval(c, -15 + (mint ? 5 : -4), -56, 3, 5, INK, 0);
  oval(c, 18 + (mint ? 4 : -5), -66, 3, 4, INK, 0);
  if (t > 21 && !mint) path(c, [-18, -13, 20, -13], undefined, INK, 3);
  else if (run || mode === 3) oval(c, 0, -16, 13, 10, INK, 2);
  else path(c, [-18, -21, -4, -16 + boil, 10, -20, 22, -26], undefined, INK, 3);
  oval(c, 34, -27, 4, 8, "#7adaed", 1);
  if (mode === 1) {
    box(c, -25, -125, 50, 29, "#ae713f");
    oval(c, 0, -100, 68, 8, "#cf954f");
  }
  if (mode === 2) {
    path(c, [-32, -87, -24, -101, 0, -98, 22, -104, 31, -88], "#7c4d73");
    text(c, "PROTEIN", 0, 7, 10, INK);
  }
  if (mode === 3) {
    path(c, [-48, 2, 0, 16, 48, 2, 32, 31, -30, 31], "#fff5db");
    oval(c, 0, -15, 11, 7, "#fa69cb");
  }
  c.restore();
}
function garage(c: Ctx, t: number) {
  box(c, -100, 0, 1120, 540, "#dbc395", 0);
  for (let x = 20; x < 1000; x += 85)
    path(c, [x, 80, x - 10, 220, x + 7, 400], undefined, "#bca783", 2);
  box(c, 45, 85, 205, 120, "#8b8d81");
  for (let i = 0; i < 5; i++) {
    path(c, [75 + i * 33, 110, 80 + i * 33, 166], undefined, INK, 7);
    oval(c, 75 + i * 33, 111, 7, 10, "#bbc9b9");
  }
  box(c, 650, 86, 230, 75, "#f0dfac");
  text(c, "KEIN TESTSYSTEM", 765, 113, 19, INK);
  text(c, "(wahrscheinlich)", 765, 141, 13, INK);
  box(c, -50, 418, 1080, 130, "#9c8b7d", 0);
  path(c, [0, 450, 1000, 450], undefined, "#776c68", 3);
  box(c, 320, 358, 255, 24, "#9c654b");
  box(c, 336, 382, 15, 50, "#805140");
  box(c, 548, 382, 15, 50, "#805140");
  c.save();
  c.translate(412, 315);
  c.rotate(-0.06 + (t < 3.8 ? Math.sin(t * 18) * 0.018 : 0));
  box(c, -60, -18, 115, 58, "#6d8c8e");
  box(c, -10, -52, 70, 35, "#c3bb86");
  box(c, 45, -35, 90, 36, "#aa7d91");
  oval(c, 136, -17, 13, 23, "#3c324c");
  oval(c, -35, 7, 15, 15, "#ffe574");
  path(c, [-35, 7, -27, -2], undefined, INK, 3);
  path(c, [-15, 40, -22, 62, 21, 65, 30, 36], undefined, "#fa5eb7", 6);
  for (let i = 0; i < 3; i++) oval(c, 8 + i * 18, 12, 4, 4, t > 2.7 ? "#ff5eb8" : "#d7f87d", 1);
  text(c, "TRANSFER", -4, 30, 11, CREAM);
  c.restore();
  if (t < 3.6) {
    const k = smooth(t / 2.7);
    c.save();
    c.translate(mix(200, 414, k), mix(253, 263, k) - Math.sin(k * Math.PI) * 65);
    c.rotate(mix(-1, 0, k));
    box(c, -25, -9, 50, 18, "#e2bb65");
    text(c, "++", 0, 0, 12, INK);
    c.restore();
  }
  oval(c, 780, 421, 45, 7, "#c6e358", 2);
  text(c, "GARAGE / SEKTOR 00", 153, 477, 12, INK);
}
function alien(c: Ctx, t: number) {
  box(c, 1000, 0, 1210, 540, "#754693", 0);
  oval(c, 1920, 111, 66, 66, "#eb9cbb", 0);
  oval(c, 1900, 96, 10, 12, "#bc709f", 0);
  for (let i = 0; i < 13; i++) oval(c, 1110 + i * 81, 85 + ((i * 53) % 160), 2, 3, "#ffe5a4", 0);
  for (let i = 0; i < 6; i++) {
    const x = 1100 + i * 185,
      y = 240 + Math.sin(i * 3 + t * 0.5) * 12;
    path(c, [x - 55, y, x + 34, y - 20, x + 68, y + 6, x + 4, y + 49], "#9b67aa", INK, 2);
  }
  path(
    c,
    [
      1050, 433, 1180, 398, 1290, 440, 1430, 410, 1580, 445, 1740, 412, 1950, 430, 2210, 405, 2210,
      550, 1050, 550,
    ],
    "#443654",
  );
  for (let i = 0; i < 4; i++) {
    const x = 1250 + i * 180,
      y = i % 2 ? 367 : 392;
    path(c, [x - 90, y, x + 65, y - 8, x + 88, y + 9, x + 18, y + 57, x - 65, y + 31], "#7a687b");
    path(c, [x - 90, y, x - 15, y - 11, x + 65, y - 8, x + 88, y + 9, x + 8, y + 17], "#d4bc78");
  }
  for (let i = 0; i < 5; i++) {
    const x = 1135 + i * 225,
      sway = Math.sin(t * 1.7 + i) * 9;
    path(c, [x, 446, x + sway, 397, x + 19 + sway, 375], undefined, "#e976a7", 9);
    oval(c, x + 20 + sway, 372, 22, 13, "#9ed988");
    oval(c, x + 25 + sway, 369, 8, 8, "#fff8d4");
    oval(c, x + 26 + sway, 370, 2, 3, INK, 0);
  }
  text(c, "DIMENSION 404 · BODEN NICHT GEFUNDEN", 1640, 477, 12, "#dec5df");
}
function table(c: Ctx, x: number, y: number, t: number) {
  const leg = Math.sin(t * 22) * 9;
  path(c, [x - 12, y + 10, x - 20 - leg, y + 27, x - 28 - leg, y + 25], undefined, INK, 3);
  path(c, [x + 12, y + 10, x + 20 + leg, y + 27, x + 29 + leg, y + 25], undefined, INK, 3);
  box(c, x - 24, y - 13, 48, 30, "#f6d86c", 3);
  path(c, [x - 24, y - 3, x + 24, y - 3], undefined, INK, 2);
  path(c, [x - 7, y - 13, x - 7, y + 17], undefined, INK, 2);
  oval(c, x + 3, y + 5, 3, 5, "#fff");
  oval(c, x + 15, y + 4, 3, 5, "#fff");
}
function worm(c: Ctx, t: number) {
  const show = smooth((t - 13.7) / 0.5) * (1 - smooth((t - 15.7) / 0.6));
  if (show <= 0) return;
  c.save();
  c.globalAlpha = show;
  box(c, 1395, 65, 345, 140, "#493052", 12);
  text(c, "KURZ BEIM LOKALEN DATENVERARBEITER", 1567, 82, 10);
  c.translate(1540, 217);
  c.scale(0.8, 0.8);
  for (let i = 9; i >= 0; i--) {
    const x = -150 + i * 23,
      y = -25 - Math.sin(i * 0.33) * 68;
    box(c, x, y, 33, 26, i % 2 ? "#b6da68" : "#d7ed89", 8);
    path(c, [x + 7, y + 7, x + 25, y + 7], undefined, INK, 2);
  }
  oval(c, 85, -93, 37, 33, "#c8e67d");
  oval(c, 98, -94, 19, 24, "#4f264c");
  path(c, [87, -114, 94, -100, 101, -115, 107, -99, 113, -110], "#fff1ce", INK, 2);
  oval(c, 71, -120, 12, 15, "#fff");
  oval(c, 75, -118, 3, 4, INK, 0);
  const k = smooth((t - 14.3) / 0.8);
  c.save();
  c.translate(mix(192, 100, k), mix(-135, -94, k));
  c.scale(1 - k * 0.9, 1 - k * 0.9);
  box(c, -36, -17, 72, 34, "#83dce1");
  text(c, "{JSON}", 0, 0, 16, INK);
  c.restore();
  if (t > 15) {
    oval(c, 103, -63, 9, 15, "#c4ef5c");
    text(c, "BURP", 150, -145, 18, CREAM);
  }
  c.restore();
}
function alternates(c: Ctx, s: RiftScene) {
  for (let i = 0; i < 3; i++) {
    const appear = smooth((s.t - 10.5 - i * 0.65) / 0.65);
    const take = smooth((s.t - 16.3 - i * 0.9) / 0.8);
    if (appear === 0 || take === 1) continue;
    const x = 1555 + i * 114 + (i === 2 ? 110 : 0),
      y = 240 + (i % 2) * 83;
    tear(c, x, y - 40, 0.36 * appear * (1 - smooth((s.t - 12.8) / 0.6)), s.t);
    const scale = (i === 1 ? 0.75 : 0.46) * appear * (1 - take);
    character(
      c,
      mix(x, s.source.x, take),
      mix(y, s.source.y - 50, take) - Math.sin(take * Math.PI) * 80,
      scale,
      -take * 5,
      false,
      s.t,
      i + 1,
    );
    if (s.t < 16.3)
      text(
        c,
        i === 0 ? "SELECT 'YEEHAW'" : i === 1 ? "BULK INSERT" : "0 ANS / 0 INDEX",
        x,
        y - 125 * scale - 25,
        10,
        "#fff2c5",
      );
  }
}
function vacuum(c: Ctx, s: RiftScene) {
  if (s.t < 16 || s.t > 20.7) return;
  const power = smooth((s.t - 16) / 0.5) * (1 - smooth((s.t - 20) / 0.7));
  c.save();
  c.globalAlpha = power * 0.16;
  path(
    c,
    [
      s.source.x + 36,
      s.source.y - 32,
      s.target.x + 55,
      s.target.y - 150,
      s.target.x + 55,
      s.target.y + 50,
    ],
    "#fff1ac",
    "#ffe185",
    1,
  );
  c.restore();
  for (let i = 0; i < 20; i++) {
    const k = ((s.t - 16) * 0.8 + i / 20) % 1;
    const x = mix(s.target.x, s.source.x + 35, smooth(k)),
      y = mix(s.target.y - 15 + (i % 5) * 11, s.source.y - 35, k) - Math.sin(k * Math.PI) * 60;
    c.save();
    c.translate(x, y);
    c.rotate(k * 4);
    c.scale(1 - k * 0.7, 1 - k * 0.7);
    box(c, -16, -5, 32, 10, i % 2 ? "#f8df82" : "#9aebe0", 2);
    c.restore();
  }
}
function names(c: Ctx, s: RiftScene) {
  const a = s.source,
    b = s.target;
  const sy = a.y - 139 * a.scale - 44 * (1 - smooth((Math.abs(a.x - b.x) - 100) / 140)),
    ty = b.y - 139 * b.scale;
  const n = s.targetName.length;
  if (a.scale > 0.3) {
    box(c, a.x - 102, sy - 16, 204, 29, INK);
    text(c, s.stolen ? s.targetName.slice(0, s.stolen) : s.sourceName, a.x, sy, 15, "#b2f2d9");
    if (s.stolen) text(c, `ehem. ${s.sourceName}`, a.x, sy - 28, 11, "#efe0bc");
  }
  box(c, b.x - 102, ty - 16, 204, 29, INK);
  if (s.stolen === n && s.t > 20) text(c, "NULL", b.x, ty, 19, "#ffdca7");
  for (let i = 0; i < n; i++) {
    const k = letterProgress(s, i);
    const tx = b.x + (i - (n - 1) / 2) * 10;
    if (k === 0) text(c, s.targetName[i], tx, ty, 15, "#ffdca7");
    else if (k < 1) {
      const x = mix(tx, a.x + (i - (n - 1) / 2) * 10, smooth(k)),
        y = mix(ty, sy, k) - Math.sin(k * Math.PI) * 95;
      oval(c, x, y, 13, 17, "#ff64cc", 2);
      text(c, s.targetName[i], x, y, 18, INK);
    }
  }
}
const LINES: [number, number, string, string][] = [
  [0.5, 3.5, "source", "Eine Migration. Nur mit mehr Rückstoß."],
  [3.8, 6.4, "target", "Das war kein FOREIGN KEY. Das war eine Tür."],
  [6.6, 9, "target", "Hier hat selbst der Boden ein Schema-Problem."],
  [9.2, 10.7, "target", "ROLLBACK! Mit der Faust."],
  [11, 13.8, "target", "Ich habe meine anderen Instanzen gerufen."],
  [14, 15.8, "worm", "JSON? Ich vertrage nur Zeilen."],
  [16, 19.8, "source", "Familien-JOIN. Ohne WHERE."],
  [20, 21.3, "target", "Warte! Mein Name ist noch da dr—"],
  [21.6, 23, "target", "NULL. Immerhin eindeutig."],
  [23.4, 25, "source", "Lokal lief's."],
];
export function drawRift(c: Ctx, s: RiftScene) {
  const t = s.t;
  const travel = smooth((t - 4.7) / 1.6);
  const end = smooth((t - 22.8) / 0.7);
  const focus = smooth((t - 20.5) / 1.2);
  const camera = mix(mix(480, 1580, travel) - focus * 110, 480, end);
  const zoom = 1 + focus * 0.11 * (1 - end);
  c.save();
  c.fillStyle = "#301c42";
  c.fillRect(0, 0, 960, 540);
  c.lineJoin = "round";
  c.lineCap = "round";
  c.translate(480 + Math.sin(s.clock * 61) * s.shake, 270 + Math.sin(s.clock * 79) * s.shake * 0.6);
  c.scale(zoom, zoom);
  c.translate(-camera, -270);
  garage(c, t);
  alien(c, t);
  if (t > 3.5 && t < 6.8)
    tear(c, 530, 260, smooth((t - 3.5) / 0.5) * (1 - smooth((t - 6) / 0.8)), t);
  if (t > 5.3 && t < 8) tear(c, 1190, 245, smooth((t - 5.3) / 0.6) * (1 - smooth((t - 7) / 1)), t);
  if (t > 19.7 && t < 21.6)
    tear(c, 1170, 245, smooth((t - 19.7) / 0.5) * (1 - smooth((t - 21.35) / 0.25)), t);
  if (t > 22.9 && t < 24)
    tear(c, 310, 250, smooth((t - 22.9) / 0.2) * (1 - smooth((t - 23.6) / 0.4)), t);
  if (t > 7 && t < 19.8)
    for (let i = 0; i < 3; i++) {
      const k = smooth((t - 7 - i * 0.4) / 12);
      const caught = smooth((t - 18 - i * 0.2) / 0.7);
      c.save();
      c.globalAlpha = 1 - caught;
      table(c, mix(1720 + i * 73, 1350, k), 416 - i * 5, t + i);
      if (t < 14) text(c, "AAAA!", mix(1720 + i * 73, 1350, k), 377 - i * 5, 10);
      c.restore();
    }
  vacuum(c, s);
  alternates(c, s);
  character(c, s.source.x, s.source.y, s.source.scale, s.source.angle, true, t);
  character(c, s.target.x, s.target.y, s.target.scale, s.target.angle, false, t);
  if (t > 9.3 && t < 9.8) text(c, "ROLLBACK!", 1515, 113, 24, "#ffea81");
  if (t > 15.1 && t < 19)
    for (let i = 0; i < 6; i++)
      oval(c, 1680 + i * 17, 403 + Math.sin(i) * 8, 10 + (i % 3) * 5, 5, "#c6ea69", 1);
  for (const p of s.particles) {
    c.globalAlpha = 1 - p.age / p.life;
    oval(c, p.x, p.y, p.size, p.size * 0.7, p.color, 0);
  }
  c.globalAlpha = 1;
  names(c, s);
  worm(c, t);
  if (t > 23.5) {
    text(c, "TRANSFER ABGESCHLOSSEN", 702, 244, 20, INK);
    text(c, "1.048.576 Zeilen · 3 Verwandte", 702, 279, 14, INK);
    text(c, "Garantiert dimensionsübergreifend.", 702, 307, 12, INK);
  }
  c.restore();
  c.fillStyle = INK;
  c.fillRect(0, 0, 960, 52);
  c.fillRect(0, 490, 960, 50);
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.font = "bold 13px ui-monospace, monospace";
  c.fillStyle = "#f2d7af";
  c.fillText("RIFT / DIMENSIONSCHAOS", 24, 25);
  c.textAlign = "right";
  c.fillStyle = "#a9e4cc";
  c.fillText(`${s.rows.toLocaleString("de-DE")} ZEILEN`, 934, 25);
  c.fillStyle = "#f564ca";
  c.fillRect(0, 49, 960 * clamp(t / RIFT_DURATION), 3);
  for (const [from, to, speaker, line] of LINES)
    if (t >= from && t < to) {
      const who =
        speaker === "source" ? s.sourceName : speaker === "target" ? s.targetName : "ZEILENWURM";
      text(c, `${who}: ${line}`, 480, 515, 14, CREAM);
    }
}
export const riftVariant: CinematicVariant = {
  id: "rift",
  label: "Dimensionschaos",
  description: "Eine Transfer-Kanone, drei Parallel-Instanzen und ein sehr hungriger Zeilenwurm.",
  jumps: riftJumps,
  create(sourceName, targetName, seed) {
    const scene = createRiftScene(sourceName, targetName, seed);
    return {
      time: () => scene.t,
      phase: () => {
        let label = riftJumps[0].label;
        for (const jump of riftJumps) if (scene.t >= jump.at) label = jump.label;
        return label;
      },
      finished: () => scene.t >= RIFT_DURATION,
      step: (dt) => stepRift(scene, dt),
      draw: (ctx) => drawRift(ctx, scene),
    };
  },
};
