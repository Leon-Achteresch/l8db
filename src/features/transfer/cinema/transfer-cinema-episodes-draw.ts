import {
  CONGA,
  congaX,
  deadlockSplit,
  episodeFade,
  episodeLocal,
  FORTRESS,
  FORTRESS_CARDS,
  FORTRESS_DROP,
  FORTRESS_LASER,
  fortressBlockFall,
  fortressBlocks,
  fortressCard,
  PARTY_PULL,
  rainCloudX,
  snailX,
  tableName,
  vacuumX,
} from "./transfer-cinema-episodes";
import { type Ctx, ellipse, hash, LINE, line, MONO, outline, UI } from "./transfer-cinema-paint";
import {
  clamp01,
  easeInOut,
  easeOutCubic,
  GROUND,
  muzzleAt,
  type Scene,
  sourceAt,
  targetAt,
} from "./transfer-cinema-sim";

function easeOutBack(value: number) {
  const k = value - 1;
  return 1 + 2.4 * k * k * k + 1.4 * k * k;
}

function pop(local: number, at: number, duration = 0.4) {
  return easeOutBack(clamp01((local - at) / duration));
}

function tag(ctx: Ctx, text: string, x: number, y: number, size: number, fill: string) {
  ctx.font = `800 ${size}px ${UI}`;
  const width = ctx.measureText(text).width + size * 1.2;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - size, width, size * 2, size * 0.5);
  outline(ctx, fill, 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LINE;
  ctx.fillText(text, x, y + 1);
}

function drawPadlock(ctx: Ctx, x: number, y: number, scale: number, open: number, text: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(-14, -18);
  ctx.lineTo(-14, -30 - open * 10);
  ctx.arc(0, -30 - open * 10, 14, Math.PI, 0);
  ctx.lineTo(14, -24 - open * 10);
  line(ctx, 8);
  ctx.beginPath();
  ctx.moveTo(-14, -18);
  ctx.lineTo(-14, -30 - open * 10);
  ctx.arc(0, -30 - open * 10, 14, Math.PI, 0);
  ctx.lineTo(14, -24 - open * 10);
  line(ctx, 4, "#9aa0ad");
  ctx.beginPath();
  ctx.roundRect(-30, -20, 60, 50, 9);
  outline(ctx, "#3b3646", 2.4);
  if (text) {
    ctx.font = `800 9px ${UI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4f2f8";
    ctx.fillText(text, 0, -6);
  }
  ellipse(ctx, 0, 10, 5, 5, "#1b1920");
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(0, 22);
  line(ctx, 3, "#1b1920");
  ctx.restore();
}

function drawCoffee(ctx: Ctx, scene: Scene, local: number, fade: number) {
  const scale = pop(local, 0.5) * fade;
  if (scale <= 0.01) return;
  const x = 480;
  ctx.save();
  ctx.translate(x, GROUND + 6);
  ctx.scale(1, scale);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 50, -44);
    ctx.lineTo(side * 64, 8);
    line(ctx, 5);
  }
  ctx.beginPath();
  ctx.ellipse(0, -46, 82, 14, 0, 0, Math.PI * 2);
  outline(ctx, "#f6dfb8", 2.2);
  ctx.beginPath();
  ctx.moveTo(0, -48);
  ctx.lineTo(0, -128);
  line(ctx, 4);
  ctx.beginPath();
  ctx.roundRect(-52, -196, 104, 70, 6);
  outline(ctx, "#ffd166", 2.4);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-52, -196, 104, 70, 6);
  ctx.clip();
  ctx.fillStyle = LINE;
  for (let stripe = -60; stripe < 60; stripe += 14) {
    ctx.beginPath();
    ctx.moveTo(stripe, -196);
    ctx.lineTo(stripe + 7, -196);
    ctx.lineTo(stripe + 1, -186);
    ctx.lineTo(stripe - 6, -186);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(stripe, -136);
    ctx.lineTo(stripe + 7, -136);
    ctx.lineTo(stripe + 1, -126);
    ctx.lineTo(stripe - 6, -126);
    ctx.fill();
  }
  ctx.restore();
  ctx.font = `800 15px ${UI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LINE;
  ctx.fillText("LOCK", 0, -169);
  ctx.fillText("WARTET", 0, -152);
  ctx.restore();
  const hover = Math.sin(scene.clock * 2) * 5;
  const open = clamp01((local - (scene.episode?.duration ?? 14) + 1.6) / 0.4);
  ctx.save();
  ctx.globalAlpha = scale;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(sourceAt(scene).x + 40, 170);
  ctx.quadraticCurveTo(480, 60, targetAt(scene).x - 40, 170);
  line(ctx, 2, "rgba(43,38,51,0.35)");
  ctx.setLineDash([]);
  ctx.translate(480, 104 + hover);
  ctx.rotate(-0.14);
  ctx.beginPath();
  ctx.roundRect(-34, -18, 58, 38, 5);
  outline(ctx, "#f4f2f8", 2);
  ctx.beginPath();
  ctx.moveTo(-26, -6);
  ctx.lineTo(4, -6);
  ctx.moveTo(-26, 4);
  ctx.lineTo(-2, 4);
  line(ctx, 2, "rgba(43,38,51,0.4)");
  drawPadlock(ctx, 22, 8, 0.5, open, "");
  ctx.restore();
}

function drawDeadlock(ctx: Ctx, scene: Scene, local: number, fade: number) {
  if (fade <= 0.01) return;
  const split = deadlockSplit(local);
  const left = sourceAt(scene).x + 64;
  const right = targetAt(scene).x - 64;
  const mid = (left + right) / 2;
  const y = GROUND - 72;
  const tug = Math.sin(scene.clock * 5) * 4 * (1 - split);
  ctx.save();
  ctx.globalAlpha = fade;
  for (const side of [-1, 1]) {
    const from = side < 0 ? left : right;
    const fly = split * 140;
    const to = mid + side * 30 + tug;
    const pivot = (from + to) / 2;
    ctx.save();
    ctx.globalAlpha = fade * (1 - clamp01((local - 10) / 0.8));
    ctx.translate(pivot + side * fly, y - split * 40 + split * split * 120);
    ctx.rotate(side * split * 0.8);
    ctx.translate(-pivot, -y);
    const folds = 4;
    ctx.beginPath();
    for (let index = 0; index <= folds; index++) {
      const x = from + ((to - from) * index) / folds;
      const lift = index % 2 === 0 ? -26 : -20;
      if (index === 0) ctx.moveTo(x, y + lift);
      else ctx.lineTo(x, y + lift);
    }
    for (let index = folds; index >= 0; index--) {
      const x = from + ((to - from) * index) / folds;
      ctx.lineTo(x, y + (index % 2 === 0 ? 26 : 20));
    }
    ctx.closePath();
    outline(ctx, "#f4f2f8", 2);
    ctx.beginPath();
    for (let index = 1; index < folds; index++) {
      const x = from + ((to - from) * index) / folds;
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x, y + 22);
    }
    ctx.moveTo(Math.min(from, to), y);
    ctx.lineTo(Math.max(from, to), y);
    line(ctx, 1.2, "rgba(43,38,51,0.35)");
    ctx.restore();
  }
  const drop = split * split * 260;
  drawPadlock(ctx, mid + tug, y - 2 + drop, 1.1, split, "DEADLOCK");
  if (split > 0 && split < 1) {
    ctx.font = `900 26px ${UI}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6b6b";
    ctx.fillText("SHARDING!", mid, y - 90 - split * 20);
  }
  for (const [x, side] of [
    [sourceAt(scene).x - 34, -1],
    [targetAt(scene).x + 34, 1],
  ] as const) {
    if (split > 0.5) break;
    const phase = (scene.clock * 3 + (side > 0 ? 0.5 : 0)) % 1;
    ctx.globalAlpha = fade * (1 - phase) * 0.7;
    ellipse(
      ctx,
      x + side * phase * 30,
      GROUND + 14 - phase * 10,
      8 + phase * 8,
      5 + phase * 4,
      "#d9d2c3",
    );
  }
  ctx.restore();
}

function drawVacuum(ctx: Ctx, scene: Scene, local: number) {
  const episode = scene.episode;
  if (!episode) return;
  const x = vacuumX(local, episode.duration);
  if (x < -100 || x > 1060) return;
  const c = scene.clock;
  const y = GROUND + 4;
  ctx.save();
  ctx.translate(x, y + Math.abs(Math.sin(c * 14)) * -1.5);
  ctx.globalAlpha = 0.6;
  for (let index = 0; index < 4; index++) {
    const phase = (c * 2.4 + index / 4) % 1;
    const spread = (1 - phase) * 26;
    ctx.beginPath();
    ctx.moveTo(-58 - (1 - phase) * 90, -24 - spread + index * 8);
    ctx.quadraticCurveTo(-70 - (1 - phase) * 40, -22, -56, -22);
    line(ctx, 1.6, "#ffffff");
  }
  ctx.globalAlpha = 1;
  for (const wheel of [-26, 0, 26]) {
    ellipse(ctx, wheel, 2, 7, 7, "#3f4552");
    ctx.beginPath();
    ctx.arc(wheel, 2, 7, 0, Math.PI * 2);
    line(ctx, 1.8);
  }
  ctx.beginPath();
  ctx.moveTo(-46, -4);
  ctx.quadraticCurveTo(-46, -56, 4, -58);
  ctx.quadraticCurveTo(50, -56, 50, -4);
  ctx.closePath();
  outline(ctx, "#e6e8ec", 2.4);
  ctx.beginPath();
  ctx.ellipse(-46, -22, 12, 16, 0, 0, Math.PI * 2);
  outline(ctx, "#9aa0ad", 2.2);
  ellipse(ctx, -48, -22, 6, 10, "#3b3646");
  ctx.beginPath();
  ctx.ellipse(6, -60, 12, 6, 0, Math.PI, 0);
  outline(ctx, "#7fe3e0", 2);
  ctx.beginPath();
  ctx.roundRect(-20, -36, 54, 16, 8);
  outline(ctx, "#3b3646", 1.8);
  ctx.font = `800 9px ${UI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f4f2f8";
  ctx.fillText("VACUUM", 7, -28);
  ctx.beginPath();
  ctx.moveTo(-10, -12);
  ctx.lineTo(24, -12);
  line(ctx, 3, Math.sin(c * 8) > 0 ? "#7fe3e0" : "#4fb3b0");
  ctx.restore();
}

function drawTableWalker(ctx: Ctx, x: number, c: number, index: number, name: string) {
  const step = c * 9 + index * 1.3;
  const bob = Math.abs(Math.sin(step)) * -6;
  ctx.save();
  ctx.translate(x, GROUND + 4 + bob);
  for (const side of [-1, 1]) {
    const swing = Math.sin(step + (side > 0 ? Math.PI : 0)) * 7;
    ctx.beginPath();
    ctx.moveTo(side * 8, -10);
    ctx.lineTo(side * 8 + swing, 8);
    line(ctx, 3);
    ellipse(ctx, side * 8 + swing + side * 2, 9, 5, 3, "#3f4552");
  }
  ctx.rotate(Math.sin(step) * 0.06);
  ctx.beginPath();
  ctx.roundRect(-20, -46, 40, 36, 4);
  outline(ctx, "#ffffff", 2);
  ctx.beginPath();
  ctx.moveTo(-20, -34);
  ctx.lineTo(20, -34);
  ctx.moveTo(-20, -22);
  ctx.lineTo(20, -22);
  ctx.moveTo(-6, -46);
  ctx.lineTo(-6, -10);
  ctx.moveTo(8, -46);
  ctx.lineTo(8, -10);
  line(ctx, 1.2, "rgba(43,38,51,0.45)");
  ellipse(ctx, -7, -28, 2.6, 2.6, LINE);
  ellipse(ctx, 7, -28, 2.6, 2.6, LINE);
  const text = name.length > 9 ? `${name.slice(0, 8)}…` : name;
  ctx.font = `700 10px ${MONO}`;
  const width = ctx.measureText(text).width + 10;
  ctx.beginPath();
  ctx.roundRect(-width / 2, -62, width, 15, 4);
  outline(ctx, "#ffe8a3", 1.6);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LINE;
  ctx.fillText(text, 0, -54);
  ctx.restore();
}

function drawConga(ctx: Ctx, scene: Scene, local: number) {
  const left = sourceAt(scene).x + 40;
  const right = targetAt(scene).x - 30;
  for (let index = CONGA.count - 1; index >= 0; index--) {
    const x = congaX(local, index);
    if (x < left || x > right) continue;
    const appear = clamp01((right - x) / 30);
    ctx.globalAlpha = appear;
    drawTableWalker(ctx, x, scene.clock, index, tableName(scene, index));
    const next = congaX(local, index + 1);
    if (index < CONGA.count - 1 && next <= right) {
      ctx.beginPath();
      ctx.moveTo(x + 20, GROUND - 28);
      ctx.lineTo(next - 20, GROUND - 28);
      line(ctx, 2.4);
    }
  }
  ctx.globalAlpha = 1;
  ctx.font = `800 18px ${UI}`;
  ctx.textAlign = "center";
  ctx.fillStyle = LINE;
  for (let index = 0; index < 3; index++) {
    const phase = (scene.clock * 0.6 + index / 3) % 1;
    if (local < CONGA.start || local > 12) break;
    ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.8;
    ctx.fillText(
      index % 2 ? "♪" : "♫",
      360 + index * 90 + Math.sin(phase * 6) * 10,
      300 - phase * 80,
    );
  }
  ctx.globalAlpha = 1;
}

function drawSnail(ctx: Ctx, scene: Scene, local: number, fade: number) {
  const x = snailX(local);
  const c = scene.clock;
  const resting = x >= 560;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.save();
  ctx.translate(612, GROUND + 18);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -52);
  line(ctx, 2.6);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      ctx.fillStyle = (row + column) % 2 ? "#ffffff" : LINE;
      ctx.fillRect(column * 6, -52 + row * 6, 6, 6);
    }
  }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0, -52, 24, 18);
  ctx.restore();
  const crawl = resting ? 0 : Math.sin(c * 5) * 3;
  ctx.translate(x, GROUND + 22);
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.quadraticCurveTo(-44, -10, -20, -12);
  ctx.lineTo(30 + crawl, -12);
  ctx.quadraticCurveTo(46 + crawl, -14, 48 + crawl, -2);
  ctx.quadraticCurveTo(48 + crawl, 2, 30, 2);
  ctx.closePath();
  outline(ctx, "#f6e08a", 2.2);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(38 + crawl + side * 3, -12);
    ctx.lineTo(42 + crawl + side * 9, resting ? -24 : -34);
    line(ctx, 2.2);
    drawStalkEye(ctx, 42 + crawl + side * 9, resting ? -26 : -36, resting);
  }
  ctx.beginPath();
  ctx.arc(-6, -30, 24, 0, Math.PI * 2);
  outline(ctx, "#c98b5a", 2.4);
  ctx.beginPath();
  for (let angle = 0; angle < Math.PI * 5; angle += 0.3) {
    const radius = 20 - angle * 1.2;
    const px = -6 + Math.cos(angle) * radius;
    const py = -30 + Math.sin(angle) * radius;
    if (angle === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  line(ctx, 2, "rgba(43,38,51,0.6)");
  ctx.save();
  ctx.translate(-6, -66);
  ctx.rotate(-0.08);
  ctx.beginPath();
  ctx.moveTo(-30, -18);
  ctx.lineTo(30, -18);
  ctx.lineTo(30, 14);
  ctx.lineTo(-30, 14);
  ctx.closePath();
  outline(ctx, "#ffffff", 2);
  ctx.beginPath();
  ctx.moveTo(-30, -18);
  ctx.lineTo(0, 0);
  ctx.lineTo(30, -18);
  line(ctx, 1.6);
  ctx.font = `800 11px ${UI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LINE;
  ctx.fillText("PING", 0, 6);
  ctx.restore();
  ctx.restore();
}

function drawStalkEye(ctx: Ctx, x: number, y: number, closed: boolean) {
  ellipse(ctx, x, y, 5, 5, "#ffffff");
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  line(ctx, 1.6);
  if (closed) {
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    line(ctx, 1.6);
  } else {
    ellipse(ctx, x + 1.5, y, 1.6, 1.6, LINE);
  }
}

function drawFortress(ctx: Ctx, scene: Scene, local: number) {
  const cards = fortressBlocks(local);
  const wobble = Math.sin(scene.clock * 9) * clamp01((local - FORTRESS_LASER) / 0.6) * 0.06;
  for (let index = 0; index < cards; index++) {
    const fall = fortressBlockFall(local, index);
    const card = fortressCard(index);
    const bounce = 1 - easeOutBack(fall);
    const y = card.y - bounce * 160;
    const [, row] = FORTRESS_CARDS[index];
    if (row > 0 && fall >= 1) {
      ctx.beginPath();
      ctx.moveTo(card.x + FORTRESS.card / 2, y + FORTRESS.height);
      ctx.lineTo(card.x + FORTRESS.card / 2 - 22, y + FORTRESS.height + 8);
      ctx.moveTo(card.x + FORTRESS.card / 2, y + FORTRESS.height);
      ctx.lineTo(card.x + FORTRESS.card / 2 + 22, y + FORTRESS.height + 8);
      line(ctx, 1.6);
    }
    ctx.save();
    ctx.translate(card.x + FORTRESS.card / 2, y + FORTRESS.height / 2);
    ctx.rotate(wobble * (index % 2 ? 1 : -1) + (1 - fall) * 0.3);
    const root = index === FORTRESS_CARDS.length - 1;
    const width = root ? FORTRESS.card + 22 : FORTRESS.card;
    ctx.beginPath();
    ctx.roundRect(-width / 2, -FORTRESS.height / 2, width, FORTRESS.height, 3);
    outline(ctx, "#ffffff", 2);
    ctx.beginPath();
    ctx.moveTo(-width / 2 + 4, -FORTRESS.height / 2 + 7);
    ctx.lineTo(width / 2 - 4, -FORTRESS.height / 2 + 7);
    line(ctx, 1.4, "#ff8fab");
    if (root) {
      ctx.font = `800 11px ${UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = LINE;
      ctx.fillText("INDEX", 0, 4);
    } else {
      ctx.beginPath();
      for (const offset of [2, 8]) {
        ctx.moveTo(-width / 2 + 5, offset);
        ctx.lineTo(width / 2 - 5, offset);
      }
      line(ctx, 1.2, "#7fb8ff");
    }
    ctx.restore();
  }
  const laser = clamp01((local - FORTRESS_LASER) / (FORTRESS_DROP - FORTRESS_LASER));
  if (laser > 0 && laser < 1) {
    const muzzle = muzzleAt(scene);
    const target = fortressCard(0);
    const tx = target.x + 6;
    const ty = target.y + FORTRESS.height - 6;
    const width = 3 + Math.sin(laser * Math.PI) * 6;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    ctx.moveTo(muzzle.x + 8, muzzle.y);
    ctx.lineTo(tx, ty);
    line(ctx, width * 2.4, "rgba(127,227,224,0.35)");
    ctx.beginPath();
    ctx.moveTo(muzzle.x + 8, muzzle.y);
    ctx.lineTo(tx, ty);
    line(ctx, width, "#e6fffd");
    ellipse(ctx, tx, ty, 8 + laser * 10, 8 + laser * 10, "rgba(255,240,180,0.7)");
    ctx.restore();
  }
}

function drawCloud(ctx: Ctx, scene: Scene, local: number, fade: number) {
  const x = rainCloudX(scene, local);
  const y = 86 + Math.sin(scene.clock * 1.4) * 4;
  const grow = pop(local, 0.2, 0.6) * fade;
  if (grow <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(grow, grow);
  ctx.beginPath();
  ctx.moveTo(-70, 18);
  ctx.quadraticCurveTo(-90, 18, -82, -2);
  ctx.quadraticCurveTo(-78, -24, -50, -18);
  ctx.quadraticCurveTo(-40, -46, -6, -38);
  ctx.quadraticCurveTo(16, -58, 40, -34);
  ctx.quadraticCurveTo(72, -38, 76, -10);
  ctx.quadraticCurveTo(96, 4, 72, 18);
  ctx.closePath();
  outline(ctx, "#8e86a8", 2.4);
  ctx.beginPath();
  ctx.moveTo(-60, 10);
  ctx.quadraticCurveTo(0, 18, 60, 10);
  line(ctx, 1.6, "rgba(43,38,51,0.35)");
  ctx.restore();
}

const CONFETTI = Array.from({ length: 26 }, (_, index) => ({
  angle: -Math.PI * (0.15 + hash(index + 2) * 0.7),
  distance: 80 + hash(index + 11) * 150,
  spin: (hash(index + 21) - 0.5) * 14,
  color: ["#ff8fab", "#ffd166", "#7fe3e0", "#c3a6ff", "#8fe388"][index % 5],
}));

function drawParty(ctx: Ctx, scene: Scene, local: number, fade: number) {
  const box = { x: targetAt(scene).x - 92, y: GROUND + 14 };
  const out = easeOutCubic(clamp01((local - 0.6) / 1.2));
  const back = easeInOut(clamp01((local - PARTY_PULL - 0.2) / 1.6));
  const spread = out * (1 - back);
  ctx.save();
  ctx.globalAlpha = fade;
  for (const piece of CONFETTI) {
    if (spread <= 0.01) break;
    const fall = local < PARTY_PULL ? clamp01((local - 1.8) / 3) * 40 : 40 * (1 - back);
    const px = box.x + Math.cos(piece.angle) * piece.distance * spread;
    const py = box.y - 30 + Math.sin(piece.angle) * piece.distance * spread + fall * spread;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(piece.spin * (local < PARTY_PULL ? local : 2 * PARTY_PULL - local));
    ctx.fillStyle = piece.color;
    ctx.fillRect(-4, -2.5, 8, 5);
    ctx.restore();
  }
  const lid = local < PARTY_PULL ? out : 1 - back;
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.beginPath();
  ctx.roundRect(-22, -40, 44, 40, 3);
  outline(ctx, "#c3a6ff", 2.2);
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(-5, -40, 10, 40);
  ctx.strokeRect(-5, -40, 10, 40);
  ctx.save();
  ctx.translate(-24, -40);
  ctx.rotate(-lid * 1.2);
  ctx.beginPath();
  ctx.roundRect(0, -10, 48, 10, 2);
  outline(ctx, "#c3a6ff", 2.2);
  ctx.restore();
  ctx.restore();
  const lever = pop(local, 3.2, 0.5);
  if (lever > 0.01) {
    const x = sourceAt(scene).x + 84;
    const pulled = easeOutCubic(clamp01((local - PARTY_PULL) / 0.25));
    ctx.save();
    ctx.translate(x, GROUND + 16);
    ctx.scale(1, lever);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(Math.sin(-0.7 + pulled * 1.4) * 46, -10 - Math.cos(-0.7 + pulled * 1.4) * 46);
    line(ctx, 4);
    ellipse(
      ctx,
      Math.sin(-0.7 + pulled * 1.4) * 46,
      -10 - Math.cos(-0.7 + pulled * 1.4) * 46,
      8,
      8,
      "#ff6b6b",
    );
    ctx.beginPath();
    ctx.moveTo(-36, 0);
    ctx.lineTo(-28, -16);
    ctx.lineTo(28, -16);
    ctx.lineTo(36, 0);
    ctx.closePath();
    outline(ctx, "#3b3646", 2);
    ctx.font = `800 9px ${UI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4f2f8";
    ctx.fillText("ROLLBACK", 0, -7);
    ctx.restore();
  }
  if (local > PARTY_PULL && local < PARTY_PULL + 2.2) {
    const pulse = 0.6 + 0.4 * Math.sin(scene.clock * 10);
    ctx.globalAlpha = fade * pulse;
    tag(ctx, "◀◀ ROLLBACK", 480, 120, 14, "#ffd166");
  }
  ctx.restore();
}

export function drawEpisodeBack(ctx: Ctx, scene: Scene) {
  const episode = scene.episode;
  if (!episode) return;
  const local = episodeLocal(scene);
  const fade = episodeFade(episode, local);
  if (episode.kind === "coffee") drawCoffee(ctx, scene, local, fade);
  if (episode.kind === "rain") drawCloud(ctx, scene, local, fade);
}

export function drawEpisodeFront(ctx: Ctx, scene: Scene) {
  const episode = scene.episode;
  if (!episode) return;
  const local = episodeLocal(scene);
  const fade = episodeFade(episode, local);
  if (episode.kind === "deadlock") drawDeadlock(ctx, scene, local, fade);
  if (episode.kind === "vacuum") drawVacuum(ctx, scene, local);
  if (episode.kind === "conga") drawConga(ctx, scene, local);
  if (episode.kind === "snail") drawSnail(ctx, scene, local, fade);
  if (episode.kind === "fortress") drawFortress(ctx, scene, local);
  if (episode.kind === "party") drawParty(ctx, scene, local, fade);
}

export function drawDrop(ctx: Ctx, x: number, y: number, color: string) {
  ctx.beginPath();
  ctx.roundRect(x - 9, y - 4, 18, 8, 2);
  outline(ctx, "#ffffff", 1.4);
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 4);
  ctx.lineTo(x - 3, y + 4);
  ctx.moveTo(x + 3, y - 4);
  ctx.lineTo(x + 3, y + 4);
  line(ctx, 1, color);
}
