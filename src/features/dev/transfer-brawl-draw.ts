import { type BrawlScene, clamp, type Fighter } from "./transfer-brawl-sim";

type Ctx = CanvasRenderingContext2D;
const INK = "#242135";
const SANS = '"Arial Black", "Arial", sans-serif';
function text(
  c: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  color = "#fff2d8",
  align: CanvasTextAlign = "center",
) {
  c.fillStyle = color;
  c.font = `900 ${size}px ${SANS}`;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.fillText(value, x, y);
}
function rect(c: Ctx, x: number, y: number, w: number, h: number, color: string, radius = 0) {
  c.fillStyle = color;
  if (radius) {
    c.beginPath();
    c.roundRect(x, y, w, h, radius);
    c.fill();
  } else c.fillRect(x, y, w, h);
}
function ellipse(
  c: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  outline = true,
) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  if (outline) {
    c.strokeStyle = INK;
    c.lineWidth = 3.4;
    c.stroke();
  }
}
function stroke(c: Ctx, width = 4, color = INK) {
  c.lineWidth = width;
  c.strokeStyle = color;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.stroke();
}
function line(c: Ctx, x: number, y: number, tx: number, ty: number, color = INK, width = 4) {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(tx, ty);
  stroke(c, width, color);
}
function star(c: Ctx, x: number, y: number, radius: number, color: string, spin = 0) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 + spin;
    const r = i % 2 ? radius * 0.4 : radius;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
  c.fillStyle = color;
  c.fill();
  stroke(c, 2);
}
function backdrop(c: Ctx, s: BrawlScene) {
  rect(c, -300, -200, 1560, 950, "#4a3f67");
  rect(c, -300, 175, 1560, 250, "#af6679");
  ellipse(c, 774, 178, 62, 62, "#ffc496", false);
  for (let i = 0; i < 15; i++) {
    const x = i * 79 - 70;
    const h = 40 + ((i * 47) % 110);
    rect(c, x, 310 - h, 62, h + 60, "#5b4c6c");
    for (let j = 0; j < 3; j++) rect(c, x + 10 + j * 16, 325 - h, 5, 9, "#c68b8a");
  }
  line(c, -100, 164, 1050, 207, "#29283e", 5);
  for (let i = 0; i < 11; i++)
    ellipse(c, i * 100, 168 + i * 3.7, 4, 6, i % 3 ? "#ffa783" : "#a0e7d0", false);
  for (let i = 0; i < 4; i++) {
    const x = i < 2 ? 35 + i * 86 : 800 + (i - 2) * 86;
    rect(c, x, 214, 66, 177, INK, 6);
    rect(c, x + 5, 219, 56, 167, "#38374e", 3);
    for (let j = 0; j < 7; j++) {
      rect(c, x + 10, 230 + j * 21, 46, 15, "#222a3b", 2);
      rect(c, x + 15, 235 + j * 21, 21, 3, "#5b6075");
      ellipse(
        c,
        x + 48,
        237 + j * 21,
        2.5,
        2.5,
        (Math.floor(s.real * 3) + j + i) % 3 ? "#93e5c2" : "#ffb76e",
        false,
      );
    }
  }
  rect(c, -300, 375, 1560, 150, "#39374b");
  rect(c, -300, 380, 1560, 13, "#e0ac8b");
  rect(c, -300, 398, 1560, 150, "#696271");
  for (let i = 0; i < 11; i++) line(c, i * 130 - 120, 405, i * 180 - 300, 555, "#514a60", 2);
  line(c, -300, 455, 1260, 455, "#514a60", 2);
  line(c, -300, 500, 1260, 500, "#514a60", 2);
  for (const x of [85, 875]) {
    rect(c, x - 10, 344, 20, 70, "#e5b873");
    for (let j = 0; j < 4; j++) line(c, x - 9, 349 + j * 17, x + 9, 362 + j * 17, INK, 6);
  }
  rect(c, 345, 115, 270, 28, INK, 5);
  text(c, "KEIN BACKUP. KEIN PROBLEM.", 480, 129, 10, "#d6c8a7");
  text(c, "DATACENTER / HINTERHOF", 480, 442, 11, "#a49aab");
  c.save();
  c.translate(91, 325);
  c.rotate(-0.09);
  rect(c, -55, -18, 110, 36, "#e7c793", 3);
  text(c, "NO DROP", 0, 1, 14, INK);
  c.restore();
}
function limb(
  c: Ctx,
  x: number,
  y: number,
  kx: number,
  ky: number,
  tx: number,
  ty: number,
  color: string,
  width = 12,
) {
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(kx, ky, tx, ty);
  stroke(c, width + 7);
  stroke(c, width, color);
}
function fighter(c: Ctx, s: BrawlScene, f: Fighter, source: boolean) {
  const t = s.t;
  const dir = source ? 1 : -1;
  const body = source ? "#8de1bc" : "#f79585";
  const shade = source ? "#4aaf93" : "#ce626b";
  const glove = source ? "#ffe18c" : "#baa8ef";
  const full = source ? s.stolen / Math.max(1, s.targetName.length) : 0;
  const dance = source && s.ko ? Math.sin((t - 19.2) * 13) : 0;
  const walk = Math.sin(t * 18) * (s.hitstop > 0 ? 0 : 9);
  const jab = source && s.move === "jab" ? Math.exp(-Math.max(0, t - s.moveAt) * 9) : 0;
  const hurt = f.hurt;
  ellipse(c, f.x, 415, 55 + full * 14, 9, "#3c354b70", false);
  c.save();
  c.translate(f.x, f.y - Math.max(0, dance) * 14);
  c.rotate(f.angle + dance * 0.09);
  c.scale((dir * (1 + full * 0.18)) / Math.sqrt(f.squash), f.squash);
  c.translate(0, f.crouch);
  const boil = Math.sin(Math.floor(t * 7) * 9.3 + (source ? 0 : 3)) * 1.2;
  limb(c, -22, -37, -32 - walk, -19, -26 + walk + dance * 10, -2, shade, 11);
  limb(c, 21, -37, 35 + walk, -20, 31 - walk - dance * 8, -2, shade, 11);
  ellipse(c, -28 + walk + dance * 10, -3, 20, 9, INK);
  ellipse(c, 32 - walk - dance * 8, -3, 21, 9, INK);
  const reach = f.reach + jab * 45;
  const upper = source ? Math.sin(clamp((t - 10.8) / 1.3) * Math.PI) * 75 : 0;
  limb(c, -40, -104, -76, -105 - dance * 32, -68 - dance * 10, -68 - dance * 50, shade);
  ellipse(c, -68 - dance * 10, -68 - dance * 50, 17, 18, glove);
  c.beginPath();
  c.moveTo(-48, -147);
  c.bezierCurveTo(-53 + boil, -123, -48, -73, -47, -49);
  c.bezierCurveTo(-22, -28, 29, -29, 48, -49);
  c.lineTo(49 + boil, -146);
  c.closePath();
  c.fillStyle = body;
  c.fill();
  stroke(c);
  c.beginPath();
  c.moveTo(22, -143);
  c.lineTo(48, -145);
  c.lineTo(47, -50);
  c.quadraticCurveTo(36, -41, 22, -40);
  c.closePath();
  c.fillStyle = shade;
  c.fill();
  ellipse(c, 0, -147, 49, 20, source ? "#b6f0ce" : "#ffc1a1");
  c.beginPath();
  c.ellipse(0, -106, 48, 14, 0, 0.12, Math.PI - 0.12);
  stroke(c, 2.5, shade);
  c.beginPath();
  c.ellipse(0, -68, 48, 14, 0, 0.12, Math.PI - 0.12);
  stroke(c, 2.5, shade);
  rect(c, -37, -83, 8, 20, INK, 2);
  rect(c, -35, -81 + (1 - full) * 16, 4, 2 + full * 16, "#e7e289", 1);
  const eyeY = -123 + hurt * 4;
  ellipse(c, 1, eyeY, 16, 20 - hurt * 8, "#fff8e8");
  ellipse(c, 28, eyeY + 2, 14, 18 - hurt * 6, "#fff8e8");
  if (!source && s.ko) {
    for (const x of [1, 28]) {
      line(c, x - 6, eyeY - 6, x + 6, eyeY + 6, INK, 3);
      line(c, x + 6, eyeY - 6, x - 6, eyeY + 6, INK, 3);
    }
  } else {
    ellipse(c, 7 + hurt * 3, eyeY + 1, 3, 4, INK, false);
    ellipse(c, 32 - hurt * 5, eyeY + 5, 2.5, 3, INK, false);
    line(c, -12, eyeY - 20, 12, eyeY - 16, INK, 4);
    line(c, 19, eyeY - 14, 40, eyeY - 21, INK, 4);
  }
  c.beginPath();
  c.moveTo(-1, -87);
  c.quadraticCurveTo(13 + boil, -78 + hurt * 15, 34, -91);
  stroke(c, 3.5);
  if (hurt > 0.3) ellipse(c, 39, -103, 4, 7, "#8be5ed");
  if (!source && t > 15) {
    ellipse(c, 25, -78, 5, 12, "#aaeba9");
    ellipse(c, 25, -66, 4, 4, "#aaeba9");
  }
  limb(
    c,
    44,
    -101,
    59 + reach * 0.45,
    -91 - dance * 25,
    67 + reach,
    -111 - Math.max(0, dance) * 60 - upper,
    body,
  );
  ellipse(c, 67 + reach, -111 - Math.max(0, dance) * 60 - upper, 21, 18, glove);
  line(
    c,
    61 + reach,
    -117 - Math.max(0, dance) * 60 - upper,
    69 + reach,
    -116 - Math.max(0, dance) * 60 - upper,
    "#fff1cc",
    3,
  );
  c.restore();
  if (!source && s.ko) {
    for (let i = 0; i < 3; i++) {
      const a = s.real * 3 + i * 2.094;
      star(c, f.x + Math.cos(a) * 60, 338 + Math.sin(a) * 13, 9, "#ffe292", a);
    }
  }
}
function effects(c: Ctx, s: BrawlScene) {
  const t = s.t;
  if (t > 5.75 && t < 6.65) {
    c.save();
    c.globalAlpha = 0.5 + Math.sin(t * 25) * 0.13;
    ellipse(c, s.target.x, 320, 91, 115, "#a7bdff40");
    c.strokeStyle = "#bbd7ff";
    c.lineWidth = 5;
    c.stroke();
    for (let i = 0; i < 3; i++) {
      const x = s.target.x - 60 - i * 25;
      line(c, x + 10, 280, x - 4, 295, "#e3e8ff", 5);
      line(c, x - 4, 295, x + 10, 310, "#e3e8ff", 5);
    }
    c.restore();
    text(c, "ROLLBACK ↶", s.target.x, 192, 23, "#cee3ff");
  }
  if (t > 6.75 && t < 8.65) {
    const u = clamp((t - (t < 7.65 ? 6.75 : 7.65)) / 0.6);
    const x = s.target.x + (s.source.x - s.target.x) * u;
    const y = 300 - Math.sin(u * Math.PI) * 125;
    ellipse(c, x, y, 25, 25, "#242638");
    text(c, "NULL", x, y, 11, "#ecdaff");
    line(c, x + 10, y - 24, x + 18, y - 34, "#ffb778", 3);
    star(c, x + 18, y - 37, 8, "#ffe79d", t * 9);
    if (t > 7.8) text(c, "DUCK!", s.source.x - 20, 249, 18, "#ffdd91");
  }
  if (t > 9 && t < 10.25) {
    const u = Math.sin(clamp((t - 9) / 1.25) * Math.PI);
    const x = s.target.x - 55;
    const end = x + (s.source.x - x) * u;
    for (let i = 0; i < 18; i++) {
      const v = i / 17;
      c.save();
      c.translate(x + (end - x) * v, 305 + Math.sin(v * Math.PI * 2 + t * 8) * 25 * u);
      c.rotate(Math.sin(v * 5 + t * 8) * 0.6);
      ellipse(c, 0, 0, 12, 5, "#c9c3df");
      c.restore();
    }
    text(c, "FOREIGN KEY", (x + end) / 2, 230, 22, "#d6caff");
    text(c, "ON DELETE: AUA", (x + end) / 2, 253, 10, "#fff1db");
  }
  if (t > 10.6 && t < 11.5) {
    for (let i = 0; i < 5; i++)
      line(
        c,
        s.source.x - 130 - i * 18,
        s.source.y - 40 - i * 18,
        s.source.x - 50,
        s.source.y - 75 - i * 18,
        "#b0ebd0",
        4 - i * 0.5,
      );
    text(c, "DASH ↑ UPPERCUT", s.source.x - 50, 188, 20, "#b9f1d4");
  }
  if (t > 12.65 && t < 14.05) {
    const strength = clamp((t - 12.65) * 4) * clamp((14.05 - t) * 5);
    const x = s.source.x + 30;
    const y = s.source.y - 122;
    line(c, x, y, s.target.x, s.target.y - 105, `rgba(255,114,153,${strength * 0.35})`, 30);
    line(c, x, y, s.target.x, s.target.y - 105, "#ff6495", 9 * strength);
    line(c, x, y, s.target.x, s.target.y - 105, "#fff3c1", 3 * strength);
    text(c, "INDEX SCAN", 590, 192, 25, "#ffb8c6");
    text(c, "EXPLAIN ANALYZE: SCHMERZ", 590, 219, 10);
  }
  if (t > 16.8 && t < 19.2) {
    text(c, "JOIN", 510, 158, 47, "#ffe5a1");
    text(
      c,
      t > 17.6 ? "ZEITLUPE. KEINE TRANSAKTION." : "ZWEI TABELLEN. EIN PROBLEM.",
      510,
      196,
      11,
    );
    if (t > 17.4) {
      c.setLineDash([10, 8]);
      c.beginPath();
      c.ellipse(625, 315, 160, 115, -0.3, 0, Math.PI * 1.8);
      stroke(c, 2, "#e6d5ab");
      c.setLineDash([]);
    }
  }
  for (const p of s.particles) {
    const u = p.age / p.life;
    c.globalAlpha = Math.min(1, (1 - u) * 4);
    if (p.kind === "spark") {
      line(c, p.x, p.y, p.x - p.vx * 0.035, p.y - p.vy * 0.035, p.color, p.size * (1 - u));
    } else if (p.kind === "letter") {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(Math.sin(u * Math.PI) * 0.45);
      rect(c, -12, -15, 24, 30, INK, 3);
      text(c, p.text, 0, 0, 22, p.color);
      c.restore();
    } else if (p.kind === "data") {
      rect(c, p.x - 16, p.y - 9, 32, 18, "#1f493e", 2);
      text(c, p.text, p.x, p.y, 10, p.color);
    } else {
      c.save();
      c.font = `900 16px ${SANS}`;
      c.textAlign = "center";
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.strokeText(p.text, p.x, p.y);
      text(c, p.text, p.x, p.y, 16, p.color);
      c.restore();
    }
  }
  c.globalAlpha = 1;
}
function hud(c: Ctx, s: BrawlScene) {
  rect(c, 0, 0, 960, 92, "#201f32");
  text(c, "1P / QUELLE", 28, 17, 10, "#8de1bc", "left");
  text(c, "2P / ZIEL", 932, 17, 10, "#f79585", "right");
  const prefix = s.targetName.slice(0, s.stolen);
  const source = s.stolen ? `${s.sourceName} + ${prefix}` : s.sourceName;
  const target = s.targetName.slice(s.launched) || "[NAME ENTFERNT]";
  text(c, source, 28, 37, Math.min(19, 620 / Math.max(1, source.length)), "#e5ffeb", "left");
  text(c, target, 932, 37, 19, "#ffd7c7", "right");
  rect(c, 27, 54, 374, 21, "#0e1324", 3);
  rect(c, 559, 54, 374, 21, "#0e1324", 3);
  rect(c, 30, 57, 368 * s.sourceHp, 15, "#8de1bc", 1);
  rect(c, 930 - 368 * s.targetHp, 57, 368 * s.targetHp, 15, "#f79585", 1);
  for (let i = 1; i < 10; i++) {
    rect(c, 30 + i * 36.8, 57, 2, 15, "#201f3240");
    rect(c, 562 + i * 36.8, 57, 2, 15, "#201f3240");
  }
  text(c, "SQL", 480, 26, 12, "#a99dbd");
  text(c, s.ko ? "K.O." : `${Math.max(0, 99 - Math.floor(s.t * 3))}`, 480, 58, 31, "#ffe2a0");
  rect(c, 0, 484, 960, 56, "#201f32");
  const progress = s.ko
    ? 1
    : clamp((s.stolen / Math.max(1, s.targetName.length)) * 0.7 + (s.rows / 128000) * 0.3);
  rect(c, 28, 500, 150, 5, "#484158", 2);
  rect(c, 28, 500, 150 * progress, 5, "#8de1bc", 2);
  text(c, `TRANSFER ${Math.floor(progress * 100)} %`, 28, 521, 10, "#a8d9c7", "left");
  text(c, `${s.rows.toLocaleString("de-DE")} ZEILEN`, 932, 513, 12, "#ffe2a0", "right");
  let subtitle = "Die Migration wird persönlich.";
  if (s.t > 2.4) subtitle = `${s.sourceName}: „Ich brauche nur kurz deinen Namen.“`;
  if (s.t > 4) subtitle = `${s.targetName}: „Du hast wohl kein COMMIT mehr?“`;
  if (s.t > 5.8) subtitle = "ROLLBACK. Das zählt jetzt einfach nicht.";
  if (s.t > 6.8) subtitle = "NULL Ahnung, aber ordentlich Sprengkraft.";
  if (s.t > 8.8) subtitle = "Eine ziemlich toxische Beziehung. FOREIGN KEY.";
  if (s.t > 10.5) subtitle = "Der Index liegt jetzt auf dem Kiefer.";
  if (s.t > 12.6) subtitle = "Seq Scan hätte weniger wehgetan.";
  if (s.t > 14.2) subtitle = "Bitte den Namen buchstabieren. Mit der Faust.";
  if (s.t > 16.6) subtitle = "JOIN. Körperlich sehr eng ausgelegt.";
  if (s.t > 19.2) subtitle = "Transfer erfolgreich. Betriebsklima unverändert.";
  text(c, subtitle, 480, 515, 12, "#eee1d7");
  if (s.t < 2.4) {
    const alpha = clamp(s.t * 4) * clamp((2.4 - s.t) * 4);
    c.globalAlpha = alpha;
    rect(c, 157, 140, 646, 82, "#211f32ed", 8);
    text(c, "RUNDE 1 – TRANSFER!", 480, 181, 34, "#ffe0a0");
    text(c, s.t < 0.7 ? "3" : s.t < 1.3 ? "2" : s.t < 1.9 ? "1" : "LOS!", 480, 275, 57, "#fff4d9");
    c.globalAlpha = 1;
  }
  if (s.combo >= 2 && s.t < 17 && s.t - s.lastHit < 1.4) {
    const x = s.t < 12 ? 227 : 220;
    text(c, String(s.combo).padStart(2, "0"), x, 153, 52, "#ffe5a0");
    text(c, "HIT COMBO", x, 191, 14, "#fff3de");
  }
  if (s.ko) {
    const k = clamp((s.t - 19.2) * 4);
    c.save();
    c.translate(480, 185);
    c.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k);
    c.lineWidth = 9;
    c.strokeStyle = INK;
    c.font = `900 80px ${SANS}`;
    c.textAlign = "center";
    c.strokeText("K.O.", 0, 0);
    text(c, "K.O.", 0, 0, 80, "#ffe3a0");
    text(c, "TRANSFER ABGESCHLOSSEN", 0, 64, 15, "#d8f6de");
    c.restore();
    if (s.t > 20) {
      text(c, "SIEGER: QUELLE", 270, 320, 17, "#b4f0ce");
      text(c, "TANZ: NICHT NORMALISIERT", 270, 348, 10, "#ffecd3");
    }
  }
}
export function drawBrawl(c: Ctx, s: BrawlScene) {
  c.save();
  rect(c, 0, 0, 960, 540, "#4a3f67");
  c.save();
  c.translate(480 + Math.sin(s.real * 93) * s.shake, 270 + Math.cos(s.real * 77) * s.shake * 0.6);
  c.scale(s.zoom, s.zoom);
  c.translate(-s.cameraX, -s.cameraY);
  backdrop(c, s);
  fighter(c, s, s.target, false);
  fighter(c, s, s.source, true);
  effects(c, s);
  c.restore();
  hud(c, s);
  c.restore();
}
