import { episodeLocal, umbrellaOpen, vacuumX } from "./transfer-cinema-episodes";
import { type Ctx, ellipse, LINE, line, outline, UI } from "./transfer-cinema-paint";
import {
  activeLine,
  clamp01,
  easeOutCubic,
  GROUND,
  type Scene,
  type Speaker,
  shipOrb,
  type shipPose,
  sourceAt,
  TARGET_X,
  TIMELINE,
  targetAt,
} from "./transfer-cinema-sim";

type Pose = NonNullable<ReturnType<typeof shipPose>>;

const SOURCE_SKIN = { body: "#a8e6cf", shade: "#7fc9ae", light: "#d9f7ea", top: "#c4f0dd" };
const TARGET_SKIN = { body: "#ffb199", shade: "#e98f78", light: "#ffd6c9", top: "#ffc5b3" };

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
    const edge = y - r + r * 2 * Math.min(lid, 0.62);
    ctx.fillRect(x - r, y - r - 1, r * 2, lid >= 1 ? r * 2 + 2 : edge - y + r + 1);
    ctx.beginPath();
    if (lid >= 1) {
      ctx.moveTo(x - r * 0.7, y + 1);
      ctx.quadraticCurveTo(x, y + r * 0.55, x + r * 0.7, y + 1);
    } else {
      ctx.moveTo(x - r, edge);
      ctx.lineTo(x + r, edge);
    }
    line(ctx, 2);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  line(ctx, 2);
}

function drawLegs(ctx: Ctx, t: number, stride: number, lift: number, color: string) {
  for (const side of [-1, 1]) {
    const swing = Math.sin(t * 15 + (side > 0 ? Math.PI : 0)) * stride;
    const footX = side * 24 + swing * 16;
    const footY =
      22 - lift * 8 - Math.max(0, Math.cos(t * 15 + (side > 0 ? Math.PI : 0))) * stride * 8;
    ctx.beginPath();
    ctx.moveTo(side * 22, 4);
    ctx.quadraticCurveTo(side * 26 + swing * 6, 14, footX, footY);
    line(ctx, 7);
    ctx.beginPath();
    ctx.moveTo(side * 22, 4);
    ctx.quadraticCurveTo(side * 26 + swing * 6, 14, footX, footY);
    line(ctx, 4, color);
    ctx.beginPath();
    ctx.ellipse(footX + side * 4, footY + 2, 10, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#3f4552";
    ctx.fill();
    line(ctx, 1.8);
  }
}

function drawDizzy(ctx: Ctx, t: number, amount: number, y: number) {
  if (amount < 0.08) return;
  ctx.globalAlpha = clamp01(amount * 2);
  for (let index = 0; index < 3; index++) {
    const angle = t * 6 + (index * Math.PI * 2) / 3;
    const x = Math.cos(angle) * 46;
    const dy = Math.sin(angle) * 10;
    ctx.save();
    ctx.translate(x, y + dy);
    ctx.rotate(angle);
    ctx.beginPath();
    for (let point = 0; point < 10; point++) {
      const r = point % 2 === 0 ? 8 : 3.5;
      const a = (point * Math.PI) / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = "#ffe066";
    ctx.fill();
    line(ctx, 1.6);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function lookAt(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  return { lx: dx / length, ly: dy / length };
}

function speaking(scene: Scene, speaker: Speaker) {
  const active = activeLine(scene);
  if (!active || active.line.speaker !== speaker) return 0;
  const c = scene.clock;
  return Math.abs(Math.sin(c * 17)) * (0.6 + 0.4 * Math.abs(Math.sin(c * 5.3)));
}

type Mouth = "neutral" | "smirk" | "smile" | "grin" | "shout" | "teeth" | "worried" | "sleep";
type Brow = "calm" | "angry" | "worried" | "smug";
type Prop = "none" | "mug" | "watch" | "remote" | "baton" | "umbrella" | "point" | "lever";

type Face = { mouth: Mouth; lid: number; brow: Brow; prop: Prop; reach: number };

const MOUTH_DARK = "#5a2a35";
const TONGUE = "#d9677a";

function drawMouth(ctx: Ctx, mouth: Mouth, talk: number, x: number, y: number) {
  if (talk > 0.08 && mouth !== "sleep") {
    const open = 0.35 + talk * 0.65;
    ctx.beginPath();
    ctx.ellipse(x, y, 7 + open * 4, 2.5 + open * 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = MOUTH_DARK;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ellipse(ctx, x, y + 3 + open * 6, 7, 4 + open * 2, TONGUE);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(x, y, 7 + open * 4, 2.5 + open * 8, 0, 0, Math.PI * 2);
    line(ctx, 2);
    return;
  }
  ctx.beginPath();
  if (mouth === "neutral") {
    ctx.moveTo(x - 12, y);
    ctx.lineTo(x + 12, y);
    line(ctx, 2.2);
    return;
  }
  if (mouth === "smirk") {
    ctx.moveTo(x - 13, y + 1);
    ctx.quadraticCurveTo(x + 2, y + 6, x + 14, y - 5);
    line(ctx, 2.2);
    return;
  }
  if (mouth === "smile") {
    ctx.moveTo(x - 14, y - 3);
    ctx.quadraticCurveTo(x, y + 12, x + 14, y - 3);
    line(ctx, 2.2);
    return;
  }
  if (mouth === "worried") {
    ctx.moveTo(x - 12, y + 2);
    ctx.bezierCurveTo(x - 5, y - 4, x + 4, y + 6, x + 12, y);
    line(ctx, 2.2);
    return;
  }
  if (mouth === "sleep") {
    ctx.ellipse(x, y, 5, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = MOUTH_DARK;
    ctx.fill();
    line(ctx, 1.8);
    return;
  }
  if (mouth === "teeth") {
    ctx.roundRect(x - 15, y - 7, 30, 14, 6);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    line(ctx, 2);
    ctx.beginPath();
    ctx.moveTo(x - 15, y);
    ctx.lineTo(x + 15, y);
    for (const offset of [-7, 0, 7]) {
      ctx.moveTo(x + offset, y - 7);
      ctx.lineTo(x + offset, y + 7);
    }
    line(ctx, 1.4);
    return;
  }
  const wide = mouth === "shout";
  const w = wide ? 12 : 16;
  const h = wide ? 16 : 11;
  ctx.moveTo(x - w, y - (wide ? h * 0.4 : 2));
  if (wide) {
    ctx.ellipse(x, y, w, h, 0, Math.PI, Math.PI * 3, false);
  } else {
    ctx.quadraticCurveTo(x, y - 4, x + w, y - 2);
    ctx.quadraticCurveTo(x + w * 0.6, y + h, x, y + h);
    ctx.quadraticCurveTo(x - w * 0.6, y + h, x - w, y - 2);
  }
  ctx.closePath();
  ctx.fillStyle = MOUTH_DARK;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - w, y - (wide ? h : 6), w * 2, wide ? 7 : 5);
  ellipse(ctx, x, y + h * (wide ? 0.9 : 0.85), w * 0.6, h * 0.4, TONGUE);
  ctx.restore();
  line(ctx, 2);
}

function drawBrows(ctx: Ctx, brow: Brow, left: number, right: number, y: number) {
  ctx.beginPath();
  for (const [x, side] of [
    [left, -1],
    [right, 1],
  ] as const) {
    const inner = x - side * 12;
    const outer = x + side * 12;
    if (brow === "angry") {
      ctx.moveTo(outer, y - 6);
      ctx.lineTo(inner, y + 3);
    } else if (brow === "worried") {
      ctx.moveTo(outer, y + 2);
      ctx.quadraticCurveTo(x, y - 6, inner, y - 7);
    } else if (brow === "smug") {
      ctx.moveTo(outer, y - (side > 0 ? 8 : 1));
      ctx.quadraticCurveTo(x, y - (side > 0 ? 12 : 5), inner, y - (side > 0 ? 6 : 1));
    } else {
      ctx.moveTo(outer, y);
      ctx.quadraticCurveTo(x, y - 6, inner, y + 1);
    }
  }
  line(ctx, 2.6);
}

function drawHand(ctx: Ctx, from: [number, number], hand: [number, number], bend: number) {
  const midX = (from[0] + hand[0]) / 2;
  const midY = (from[1] + hand[1]) / 2 + bend;
  for (const [width, color] of [
    [7, LINE],
    [4.5, "#c9ccd3"],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.quadraticCurveTo(midX, midY, hand[0], hand[1]);
    line(ctx, width, color);
  }
  ellipse(ctx, hand[0], hand[1], 6, 6, "#c9ccd3");
  ctx.beginPath();
  ctx.arc(hand[0], hand[1], 6, 0, Math.PI * 2);
  line(ctx, 1.8);
}

function drawMug(ctx: Ctx, x: number, y: number, c: number, color: string) {
  ctx.beginPath();
  ctx.roundRect(x - 9, y - 18, 18, 20, 4);
  outline(ctx, color, 2);
  ctx.beginPath();
  ctx.arc(x + 10, y - 9, 5, -Math.PI / 2, Math.PI / 2);
  line(ctx, 2.4);
  ctx.globalAlpha = 0.6;
  for (const offset of [-4, 3]) {
    ctx.beginPath();
    const wave = Math.sin(c * 3 + offset) * 3;
    ctx.moveTo(x + offset, y - 22);
    ctx.quadraticCurveTo(x + offset + 4 + wave, y - 30, x + offset, y - 38);
    line(ctx, 1.6, "#8c8291");
  }
  ctx.globalAlpha = 1;
}

function drawWatch(ctx: Ctx, x: number, y: number, c: number) {
  ellipse(ctx, x, y, 9, 9, "#ffffff");
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  line(ctx, 2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(c * 4) * 6, y + Math.sin(c * 4) * 6);
  line(ctx, 1.6);
}

function drawRemote(ctx: Ctx, x: number, y: number, broken: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.2);
  ctx.beginPath();
  ctx.roundRect(-8, -24, 16, 30, 4);
  outline(ctx, "#3b3646", 2);
  ellipse(ctx, 0, -14, 5, 3.5, broken > 0.5 ? "#ff6b6b" : "#ffd166");
  ellipse(ctx, -3, -3, 2, 2, "#f4f2f8");
  ellipse(ctx, 3, -3, 2, 2, "#f4f2f8");
  ctx.restore();
}

function drawBaton(ctx: Ctx, x: number, y: number, c: number) {
  const angle = -1.1 + Math.sin(c * 7) * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * 30, y + Math.sin(angle) * 30);
  line(ctx, 2.6);
  ellipse(ctx, x + Math.cos(angle) * 30, y + Math.sin(angle) * 30, 3, 3, "#ffd166");
}

function drawUmbrella(ctx: Ctx, x: number, y: number, open: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 120);
  line(ctx, 2.6);
  if (open < 0.05) return;
  const w = 82 * open;
  const top = y - 120;
  ctx.beginPath();
  ctx.moveTo(x - w, top + 10);
  ctx.quadraticCurveTo(x - w * 0.9, top - 46 * open, x, top - 52 * open);
  ctx.quadraticCurveTo(x + w * 0.9, top - 46 * open, x + w, top + 10);
  for (let k = 1; k >= -1; k -= 0.5) {
    ctx.quadraticCurveTo(x + w * (k + 0.25), top - 2, x + w * k, top + 10);
  }
  ctx.closePath();
  outline(ctx, "#ffd166", 2.2);
  ctx.font = `800 10px ${UI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LINE;
  if (open > 0.8) ctx.fillText("ROLLBACK", x, top - 18);
}

function sourceFace(scene: Scene): Face {
  const t = scene.t;
  const episode = scene.episode;
  const local = episodeLocal(scene);
  if (scene.outcome === "failure")
    return { mouth: "worried", lid: 0.2, brow: "worried", prop: "none", reach: 0 };
  if (t > TIMELINE.outro) return { mouth: "smile", lid: 0, brow: "calm", prop: "none", reach: 0 };
  if (scene.bonk > 0.5) return { mouth: "shout", lid: 0, brow: "worried", prop: "none", reach: 0 };
  if (episode && scene.calm > 0.3) {
    const kind = episode.kind;
    if (kind === "coffee")
      return { mouth: "smile", lid: 0.45, brow: "calm", prop: "mug", reach: 0 };
    if (kind === "deadlock")
      return {
        mouth: local > 9.4 ? "shout" : "teeth",
        lid: 0,
        brow: "angry",
        prop: "none",
        reach: 1,
      };
    if (kind === "conga") return { mouth: "grin", lid: 0.4, brow: "smug", prop: "none", reach: 0 };
    if (kind === "snail")
      return { mouth: "neutral", lid: 0.35, brow: "calm", prop: "watch", reach: 0 };
    if (kind === "rain")
      return {
        mouth: local > 9.4 ? "worried" : "smirk",
        lid: local > 9.4 ? 0 : 0.35,
        brow: local > 9.4 ? "worried" : "smug",
        prop: "remote",
        reach: 0,
      };
    if (kind === "party")
      return {
        mouth: local > 4.6 ? "smirk" : "neutral",
        lid: 0.4,
        brow: "calm",
        prop: "lever",
        reach: 0,
      };
  }
  if (episode?.kind === "vacuum" && vacuumPull(scene) > 0.2)
    return { mouth: "shout", lid: 0, brow: "worried", prop: "none", reach: 0 };
  if (scene.recoil > 0.5) return { mouth: "grin", lid: 0, brow: "smug", prop: "none", reach: 0 };
  return { mouth: "smirk", lid: 0, brow: "smug", prop: "none", reach: 0 };
}

function targetFace(scene: Scene, pose: Pose | null): Face {
  const episode = scene.episode;
  const local = episodeLocal(scene);
  if (scene.outcome === "failure")
    return { mouth: "grin", lid: 0.3, brow: "smug", prop: "point", reach: 0 };
  if (pose) return { mouth: "shout", lid: 0, brow: "worried", prop: "none", reach: 0 };
  if (scene.flinch > 0.55)
    return { mouth: "teeth", lid: 0.5, brow: "angry", prop: "none", reach: 0 };
  if (episode) {
    const kind = episode.kind;
    if (kind === "coffee" && scene.calm > 0.3)
      return { mouth: "smile", lid: 0.45, brow: "calm", prop: "mug", reach: 0 };
    if (kind === "deadlock" && scene.calm > 0.3)
      return {
        mouth: local > 9.4 ? "shout" : "teeth",
        lid: 0,
        brow: "angry",
        prop: "none",
        reach: 1,
      };
    if (kind === "conga")
      return { mouth: "worried", lid: 0, brow: "worried", prop: "baton", reach: 0 };
    if (kind === "snail" && scene.calm > 0.3)
      return { mouth: "sleep", lid: 1, brow: "calm", prop: "none", reach: 0 };
    if (kind === "vacuum")
      return { mouth: "grin", lid: 0.35, brow: "smug", prop: "point", reach: 0 };
    if (kind === "fortress")
      return local > 10.2
        ? { mouth: "shout", lid: 0, brow: "worried", prop: "none", reach: 0 }
        : { mouth: "grin", lid: 0.3, brow: "smug", prop: "none", reach: 0 };
    if (kind === "rain")
      return {
        mouth: local > 9.4 ? "grin" : "worried",
        lid: local > 9.4 ? 0.35 : 0,
        brow: local > 9.4 ? "smug" : "worried",
        prop: umbrellaOpen(local) > 0.02 ? "umbrella" : "none",
        reach: 0,
      };
    if (kind === "party")
      return local < 4.6
        ? { mouth: "grin", lid: 0.3, brow: "calm", prop: "none", reach: 0 }
        : { mouth: "worried", lid: 0, brow: "worried", prop: "none", reach: 0 };
  }
  return { mouth: "worried", lid: 0, brow: "worried", prop: "none", reach: 0 };
}

function vacuumPull(scene: Scene) {
  const episode = scene.episode;
  if (episode?.kind !== "vacuum") return 0;
  const x = vacuumX(episodeLocal(scene), episode.duration);
  const distance = x - sourceAt(scene).x;
  return distance > 40 && distance < 190 ? Math.sin(((distance - 40) / 150) * Math.PI) : 0;
}

function drawBlaster(ctx: Ctx, r: number, pull: number) {
  ctx.save();
  ctx.translate(50 + pull * 46, -66 + pull * 30);
  ctx.rotate(-0.06 - r * 0.18 + pull * 0.6);
  ctx.translate(-r * 6, 0);
  ctx.beginPath();
  ctx.moveTo(-8 - pull * 46, 4);
  ctx.lineTo(16, 0);
  line(ctx, 7);
  ctx.beginPath();
  ctx.moveTo(-8 - pull * 46, 4);
  ctx.lineTo(16, 0);
  line(ctx, 4.5, "#c9ccd3");
  ctx.beginPath();
  ctx.roundRect(12, -10, 40, 18, 5);
  outline(ctx, "#e6e8ec", 2);
  ctx.beginPath();
  ctx.roundRect(48, -6, 10, 10, 3);
  outline(ctx, "#7fe3e0", 1.8);
  ctx.beginPath();
  ctx.arc(28, -10, 6, Math.PI, 0);
  outline(ctx, "#3f4552", 1.8);
  ctx.restore();
}

function drawShades(ctx: Ctx, t: number) {
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
    outline(ctx, "#1b1920", 1.6);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.55, -103);
    ctx.lineTo(x - w * 0.1, -103);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function drawShadow(ctx: Ctx, x: number, air: number, width: number) {
  ellipse(
    ctx,
    x,
    GROUND + 18,
    width * (1 - air * 0.4),
    11 * (1 - air * 0.4),
    "rgba(60,64,52,0.28)",
  );
}

export function drawSource(ctx: Ctx, scene: Scene, pose: Pose | null) {
  const t = scene.t;
  const c = scene.clock;
  const r = scene.recoil;
  const talk = speaking(scene, "source");
  const body = sourceAt(scene);
  const air = clamp01(-body.y / 80);
  const face = sourceFace(scene);
  const holster = scene.episode?.kind === "fortress" ? 0 : clamp01((scene.calm - 0.3) / 0.4);
  const pull = vacuumPull(scene);
  drawShadow(ctx, body.x, air, 74);
  if (holster > 0.05) drawGroundBlaster(ctx, body.x - 104, holster);
  ctx.save();
  ctx.translate(body.x - r * 4, GROUND + body.y);
  ctx.rotate(-0.025 * r + body.lean + Math.sin(c * 9) * 0.04 * scene.bonk);
  drawLegs(ctx, c, clamp01(Math.abs(body.x - sourceAt(scene, c - 0.08).x) / 3), air, "#7fc9ae");
  ctx.scale(
    1 + 0.03 * r + body.squash * 0.22,
    1 - 0.03 * r + Math.sin(c * 2.4) * 0.008 - body.squash * 0.22,
  );
  const sway = Math.sin(c * 2.2) * 4;
  if (face.reach > 0) {
    drawHand(ctx, [-50, -80], [64, -70 + sway * 0.3], 10);
  } else if (face.prop === "mug") {
    drawHand(ctx, [-54, -74], [-74, -84 + Math.max(0, Math.sin(c * 0.9)) * -18], 6);
  } else {
    drawHand(ctx, [-54, -74], [-72, -50 + sway], -4);
  }
  ctx.beginPath();
  ctx.moveTo(10, -164);
  ctx.quadraticCurveTo(14, -186, 22, -198);
  line(ctx, 2.4);
  ellipse(ctx, 23, -200, 6, 6, Math.sin(c * 3) > 0 ? "#7fe3e0" : "#4fb3b0");
  ctx.beginPath();
  ctx.arc(23, -200, 6, 0, Math.PI * 2);
  line(ctx, 1.8);
  drawCylinder(ctx, 116, 150, SOURCE_SKIN, 0);
  const focus = pose && t < TIMELINE.boom + 0.6 ? shipOrb(pose) : { x: TARGET_X, y: GROUND - 90 };
  const { lx, ly } = lookAt(body.x, GROUND - 98, focus.x, focus.y);
  const daze = scene.bonk > 0.25;
  const spin = c * 14;
  const blink = blinking(c, 0.3) ? 1 : face.lid;
  drawEye(
    ctx,
    -19,
    -100,
    16,
    daze ? Math.cos(spin) : lx,
    daze ? Math.sin(spin) : ly,
    2.4,
    blink,
    SOURCE_SKIN.shade,
  );
  drawEye(
    ctx,
    15,
    -102,
    14.5,
    daze ? -Math.cos(spin) : lx * 0.8,
    daze ? Math.sin(spin) : ly + 0.15,
    2.2,
    blink,
    SOURCE_SKIN.shade,
  );
  drawBrows(ctx, face.brow, -19, 15, -124);
  if (t > TIMELINE.outro + 0.3) drawShades(ctx, t);
  drawMouth(ctx, face.mouth, talk, -1, -62);
  if (face.prop === "mug")
    drawMug(ctx, -74, -84 + Math.max(0, Math.sin(c * 0.9)) * -18, c, "#ffffff");
  if (holster < 0.95 && face.reach === 0) {
    ctx.globalAlpha = 1 - holster;
    drawBlaster(ctx, r, pull);
    ctx.globalAlpha = 1;
  }
  if (face.prop === "watch" || face.prop === "remote" || face.prop === "lever") {
    const lift = face.prop === "watch" ? -96 : face.prop === "lever" ? -34 : -82;
    drawHand(ctx, [54, -74], [74, lift], 6);
    if (face.prop === "watch") drawWatch(ctx, 74, lift - 2, c);
    if (face.prop === "remote") drawRemote(ctx, 76, lift, episodeLocal(scene) > 9.4 ? 1 : 0);
  }
  drawDizzy(ctx, c, scene.bonk, -170);
  ctx.restore();
}

function drawGroundBlaster(ctx: Ctx, x: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, GROUND + 14);
  ctx.rotate(0.15);
  ctx.beginPath();
  ctx.roundRect(-20, -9, 40, 18, 5);
  outline(ctx, "#e6e8ec", 2);
  ctx.beginPath();
  ctx.roundRect(16, -5, 10, 10, 3);
  outline(ctx, "#7fe3e0", 1.8);
  ctx.restore();
}

function blinking(clock: number, seed: number) {
  const period = 3.7 + seed * 1.9;
  return (clock + seed * 2.3) % period < 0.12;
}

export function drawTarget(ctx: Ctx, scene: Scene, pose: Pose | null) {
  const t = scene.t;
  const c = scene.clock;
  const f = scene.flinch;
  const panic = pose ? 1 : 0;
  const talk = speaking(scene, "target");
  const tremble = Math.sin(c * 46) * (0.6 + panic * 1.6);
  const body = targetAt(scene);
  const air = clamp01(-body.y / 60);
  const face = targetFace(scene, pose);
  const local = episodeLocal(scene);
  drawShadow(ctx, body.x, air, 70);
  ctx.save();
  ctx.translate(body.x + f * 9 + tremble, GROUND + body.y);
  const runLean = Math.cos((t - TIMELINE.arrival - 0.8) * 5.2) * 0.12 * body.run;
  ctx.rotate(0.06 * f + runLean + (face.mouth === "sleep" ? Math.sin(c * 1.4) * 0.03 : 0));
  drawLegs(
    ctx,
    c * (1 + body.run * 0.6),
    Math.max(
      body.run,
      air > 0.05 ? 0.6 : 0,
      clamp01(Math.abs(body.x - targetAt(scene, c - 0.08).x) / 4),
    ),
    air,
    "#e98f78",
  );
  ctx.scale(
    1 - 0.04 * f + body.squash * 0.24,
    1 + 0.03 * f + Math.sin(c * 2.6 + 1) * 0.008 - body.squash * 0.24,
  );
  for (const side of [-1, 1]) {
    const wave = Math.sin(c * (4 + panic * 9) + side) * (0.25 + panic * 0.35);
    const windUp = side < 0 ? body.throwing : 0;
    let hand: [number, number] = [
      side * (74 + wave * 6) + windUp * 30,
      -60 - panic * 50 + wave * 18 - windUp * 90,
    ];
    if (face.reach > 0 && side < 0) hand = [-64, -70 + Math.sin(c * 2.2) * 1.2];
    if (face.reach > 0 && side > 0) hand = [-56, -82];
    if (face.prop === "mug" && side < 0)
      hand = [-74, -84 + Math.max(0, Math.sin(c * 0.9 + 1.4)) * -18];
    if (face.prop === "point" && side < 0) hand = [-86, -92];
    if (face.prop === "umbrella" && side > 0) hand = [44, -150];
    if (face.prop === "baton" && side > 0) hand = [78, -110 + Math.sin(c * 7) * 8];
    if (face.mouth === "sleep") hand = [side * 66, -46];
    drawHand(ctx, [side * 54, -74], hand, side * -2);
    if (face.prop === "mug" && side < 0) drawMug(ctx, hand[0], hand[1], c, "#ffffff");
    if (face.prop === "baton" && side > 0) drawBaton(ctx, hand[0], hand[1], c);
    if (face.prop === "umbrella" && side > 0)
      drawUmbrella(ctx, hand[0], hand[1], umbrellaOpen(local));
  }
  drawCylinder(ctx, 112, 144, TARGET_SKIN, f > 0.5 ? f : 0);
  ctx.beginPath();
  ctx.moveTo(-8, -158);
  ctx.quadraticCurveTo(-16, -176, -30, -180);
  line(ctx, 2.4);
  ellipse(ctx, -32, -180, 5, 5, panic && Math.sin(c * 20) > 0 ? "#ff5a5a" : "#ffd6c9");
  ctx.beginPath();
  ctx.arc(-32, -180, 5, 0, Math.PI * 2);
  line(ctx, 1.8);
  drawDamage(ctx, 1 - scene.hp);
  const focus = pose ? { x: pose.x, y: pose.y } : { x: sourceAt(scene).x, y: GROUND - 100 };
  const look = lookAt(body.x, GROUND - 96, focus.x, focus.y);
  const eyeR = pose ? 18 : 16;
  const pupil = pose ? 1.8 : 2.4;
  const lid = blinking(c, 0.8) ? 1 : face.lid;
  drawEye(ctx, -19, -96, eyeR, look.lx, look.ly, pupil, lid);
  drawEye(ctx, 17, -96, eyeR - 1, look.lx, look.ly, pupil, lid);
  drawBrows(ctx, face.brow, -19, 17, -120 - panic * 4);
  drawMouth(ctx, face.mouth, talk, 0, -56);
  if (face.mouth === "sleep") drawSnore(ctx, c);
  if (panic) drawSweat(ctx, c);
  if (face.prop === "baton") {
    ctx.font = `800 18px ${UI}`;
    ctx.textAlign = "center";
    ctx.fillStyle = LINE;
    ctx.fillText("??", 70, -150 + Math.sin(c * 3) * 3);
  }
  if (episodeParty(scene)) drawPartyHat(ctx, local);
  ctx.restore();
}

function episodeParty(scene: Scene) {
  return scene.episode?.kind === "party" && episodeLocal(scene) > 0.4;
}

function drawPartyHat(ctx: Ctx, local: number) {
  const droop = clamp01((local - 5.2) / 1.2);
  ctx.save();
  ctx.translate(14, -166);
  ctx.rotate(0.2 + droop * 1.1);
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(0, -40 + droop * 10);
  ctx.lineTo(16, 0);
  ctx.closePath();
  outline(ctx, "#c3a6ff", 2);
  ctx.beginPath();
  ctx.moveTo(-9, -12);
  ctx.lineTo(9, -14);
  line(ctx, 3, "#ffd166");
  ellipse(ctx, 0, -42 + droop * 10, 5, 5, "#ff8fab");
  ctx.restore();
}

function drawSnore(ctx: Ctx, c: number) {
  ctx.font = `800 16px ${UI}`;
  ctx.textAlign = "center";
  for (let index = 0; index < 3; index++) {
    const phase = (c * 0.5 + index / 3) % 1;
    ctx.globalAlpha = Math.sin(phase * Math.PI);
    ctx.fillStyle = LINE;
    ctx.fillText("z", 40 + phase * 30, -150 - phase * 50);
  }
  ctx.globalAlpha = 1;
}

function drawSweat(ctx: Ctx, c: number) {
  const phase = (c * 0.9) % 1;
  const x = 44;
  const y = -124 + phase * 40;
  ctx.globalAlpha = 1 - phase;
  ctx.beginPath();
  ctx.moveTo(x, y - 9);
  ctx.quadraticCurveTo(x + 6, y + 2, x, y + 4);
  ctx.quadraticCurveTo(x - 6, y + 2, x, y - 9);
  outline(ctx, "#c8ecf7", 1.4);
  ctx.globalAlpha = 1;
}

function drawDamage(ctx: Ctx, damage: number) {
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
}

export function drawWreck(ctx: Ctx, scene: Scene) {
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
