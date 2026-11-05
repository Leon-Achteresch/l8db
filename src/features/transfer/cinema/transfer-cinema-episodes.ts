import {
  between,
  clamp01,
  type Episode,
  type EpisodeKind,
  explodeAt,
  GROUND,
  type Scene,
  SOURCE_X,
  type Speaker,
  smoke,
  sourceAt,
  sparks,
  spawn,
  TARGET_X,
  targetAt,
} from "./transfer-cinema-sim";

type Script = { duration: number; lines: [number, number, Speaker, string][] };

export const EPISODES: Record<EpisodeKind, Script> = {
  coffee: {
    duration: 14,
    lines: [
      [1.2, 3.6, "source", "Kaffeepause. Der Lock wartet eh."],
      [4.4, 6.6, "target", "Ist der entkoffeiniert?"],
      [7.4, 9.8, "source", "Nein. Read Uncommitted."],
      [11, 13, "target", "Warten ist auch eine Transaktion."],
    ],
  },
  deadlock: {
    duration: 13,
    lines: [
      [1.4, 3.2, "target", "Finger weg von %table%!"],
      [3.8, 5.6, "source", "Ich hab den Lock zuerst!"],
      [6.2, 8.4, "target", "Ich warte auf dich. Du wartest auf mich."],
      [10, 12.2, "source", "Gut. Dann eben Sharding."],
    ],
  },
  vacuum: {
    duration: 12,
    lines: [
      [1.4, 3.6, "target", "Räumt der auch tote Tupel weg?"],
      [4.6, 6.4, "source", "Nur deine."],
    ],
  },
  conga: {
    duration: 14,
    lines: [
      [1, 3, "source", "Kommt rüber, Tabellen. Es gibt Kekse."],
      [4.4, 6.6, "target", "Verräter! Alle miteinander!"],
      [9.4, 11.6, "source", "Schemaänderung per Polonaise."],
    ],
  },
  snail: {
    duration: 15,
    lines: [
      [1.2, 3.4, "source", "Das Paket ist unterwegs. Ping läuft."],
      [5, 7, "target", "Weck mich, wenn es ankommt."],
      [11.6, 13.6, "source", "Läuft. Technisch gesehen."],
    ],
  },
  fortress: {
    duration: 14,
    lines: [
      [0.8, 2.8, "target", "Ha! Mein Index schützt mich!"],
      [6.2, 8.2, "source", "Netter B-Baum."],
      [9.2, 10.4, "source", "DROP INDEX."],
      [11.6, 13.4, "target", "Das war ein tragender Datensatz …"],
    ],
  },
  rain: {
    duration: 13,
    lines: [
      [1, 2.6, "target", "Es regnet … Zeilen?"],
      [3.6, 5.8, "target", "Zum Glück hab ich ROLLBACK dabei."],
      [10.2, 12.2, "source", "Na toll. Duplikate."],
    ],
  },
  party: {
    duration: 12,
    lines: [
      [0.8, 3, "target", "Party! Ich hab ein Backup gefunden!"],
      [5, 7.4, "source", "Die Freude war noch nicht committet."],
      [8.6, 10.6, "target", "Nicht der ROLLBACK-Hebel …"],
    ],
  },
};

export const EPISODE_KINDS = Object.keys(EPISODES) as EpisodeKind[];

export const FORTRESS = { x: 446, card: 40, gap: 4, height: 30 };
export const FORTRESS_CARDS = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [0.5, 1],
  [2.5, 1],
  [1.5, 2],
] as const;
const FORTRESS_BUILD = 0.6;
export const FORTRESS_LASER = 9.6;
export const FORTRESS_DROP = 10.2;
export const PARTY_PULL = 4.6;
export const CONGA = { count: 5, gap: 1.1, speed: 70, start: 1.8 };
const RAIN_SWITCH = 9;

function flag(episode: Episode, bit: number) {
  if (episode.step & bit) return false;
  episode.step |= bit;
  return true;
}

export function episodeLocal(scene: Scene) {
  return scene.episode ? scene.clock - scene.episode.start : 0;
}

export function episodeFade(episode: Episode, local: number) {
  return clamp01(local / 0.6) * clamp01((episode.duration - local) / 0.6);
}

export function vacuumX(local: number, duration: number) {
  return 1080 - (local / duration) * 1200;
}

export function snailX(local: number) {
  return Math.min(-70 + local * 56, 560);
}

export function congaX(local: number, index: number) {
  return TARGET_X - 20 - (local - CONGA.start - index * CONGA.gap) * CONGA.speed;
}

export function fortressBlocks(local: number) {
  if (local >= FORTRESS_DROP) return 0;
  return Math.min(FORTRESS_CARDS.length, Math.max(0, Math.floor(local / FORTRESS_BUILD)));
}

export function fortressCard(index: number) {
  const [column, row] = FORTRESS_CARDS[index];
  return {
    x: FORTRESS.x + column * (FORTRESS.card + FORTRESS.gap),
    y: GROUND - (row + 1) * (FORTRESS.height + 6),
  };
}

export function fortressBlockFall(local: number, index: number) {
  return clamp01((local - index * FORTRESS_BUILD) / FORTRESS_BUILD);
}

export function rainCloudX(scene: Scene, local: number) {
  const k = clamp01((local - RAIN_SWITCH) / 1.2);
  const ease = k * k * (3 - 2 * k);
  return targetAt(scene).x + (sourceAt(scene).x - targetAt(scene).x) * ease;
}

export function umbrellaOpen(local: number) {
  return clamp01((local - 3) / 0.35) * clamp01((RAIN_SWITCH + 1.6 - local) / 0.4);
}

export function deadlockSplit(local: number) {
  return clamp01((local - 9.4) / 0.5);
}

export function tableName(scene: Scene, index: number) {
  const names = scene.tables;
  if (names.length === 0)
    return ["users", "orders", "invoices", "logs", "carts", "tags"][index % 6];
  return names[(names.length - 1 - index + names.length * 8) % names.length];
}

function startCalm(scene: Scene, source: number | null, target: number | null) {
  scene.calmGoal = 1;
  scene.sourcePin = source;
  scene.targetPin = target;
}

export function startEpisode(scene: Scene, kind: EpisodeKind) {
  const script = EPISODES[kind];
  scene.episode = { kind, start: scene.clock, duration: script.duration, step: 0 };
  const table = tableName(scene, 0);
  const lines = script.lines.map(([from, to, speaker, text]) => ({
    from: scene.clock + from,
    to: scene.clock + to,
    speaker,
    text: text.replace("%table%", table),
  }));
  scene.queue = lines;
  scene.sourcePin = null;
  scene.targetPin = null;
  if (kind === "coffee") startCalm(scene, SOURCE_X + 90, TARGET_X - 90);
  if (kind === "deadlock") startCalm(scene, 320, 640);
  if (kind === "conga") startCalm(scene, SOURCE_X, TARGET_X + 40);
  if (kind === "snail" || kind === "rain" || kind === "party") startCalm(scene, null, null);
}

export function endEpisode(scene: Scene) {
  scene.episode = null;
  scene.queue = [];
  scene.calmGoal = 0;
  scene.wall = null;
  scene.wallHeight = 0;
}

export function stepEpisode(scene: Scene) {
  const episode = scene.episode;
  if (!episode) return;
  if (scene.outcome !== "running") {
    const local = scene.clock - episode.start;
    if (episode.duration > local + 0.7) episode.duration = local + 0.7;
    scene.calmGoal = 0;
    scene.queue = [];
  }
  const local = scene.clock - episode.start;
  if (local >= episode.duration) {
    endEpisode(scene);
    return;
  }
  while (scene.queue.length > 0 && scene.queue[0].from <= scene.clock) {
    scene.line = scene.queue[0];
    scene.queue.shift();
  }
  const ending = local > episode.duration - 1.6;
  if (ending && episode.kind !== "fortress") scene.calmGoal = 0;
  if (episode.kind === "vacuum") stepVacuum(scene, local, episode);

  if (episode.kind === "conga") stepConga(scene, local, episode);
  if (episode.kind === "fortress") stepFortress(scene, local, episode);
  if (episode.kind === "rain") stepRain(scene, local);
  if (episode.kind === "party") stepParty(scene, local, episode);
  if (episode.kind === "coffee" && local >= episode.duration - 1.2 && flag(episode, 1)) {
    scene.calmGoal = 0;
  }
  if (episode.kind === "deadlock" && local >= 9.4 && flag(episode, 1)) {
    sparks(scene, 480, GROUND - 120, 24, 520, "#fff2c2");
    spawn(scene, { kind: "ring", x: 480, y: GROUND - 120, life: 0.4, size: 70, color: "#ffd8a8" });
    scene.shake = Math.min(26, scene.shake + 8);
    scene.bonk = 1;
    scene.flinch = 1;
  }
  if (episode.kind === "deadlock" && local >= 10.8) scene.calmGoal = 0;
}

function stepVacuum(scene: Scene, local: number, episode: Episode) {
  const x = vacuumX(local, episode.duration);
  for (const p of scene.particles) {
    if ((p.kind === "splat" || p.kind === "debris") && Math.abs(p.x - x) < 46 && p.age < p.life) {
      p.age = p.life;
      spawn(scene, {
        kind: "spark",
        x: p.x,
        y: GROUND - 6,
        vx: (x - p.x) * 6,
        vy: -60,
        life: 0.25,
        size: 2,
        color: p.color,
      });
    }
  }
  if (scene.clock >= scene.vacuumPuff && x > 0 && x < 960) {
    smoke(scene, x - 40, GROUND - 30, between(scene, 5, 9), 0.6);
    scene.vacuumPuff = scene.clock + 0.18;
  }
}

function stepConga(scene: Scene, local: number, episode: Episode) {
  for (let index = 0; index < CONGA.count; index++) {
    if (congaX(local, index) < sourceAt(scene).x + 40 && flag(episode, 1 << index)) {
      scene.recoil = 1;
      sparks(scene, sourceAt(scene).x + 40, GROUND - 40, 6, 220, "#a8f0e8");
      spawn(scene, {
        kind: "pop",
        x: sourceAt(scene).x,
        y: GROUND - 180,
        vy: -50,
        drag: 1.5,
        life: 0.9,
        text: "*schluck*",
      });
    }
  }
}

function stepFortress(scene: Scene, local: number, episode: Episode) {
  const cards = fortressBlocks(local);
  const rows = cards >= 7 ? 3 : cards >= 5 ? 2 : cards > 0 ? 1 : 0;
  scene.wall = local < FORTRESS_DROP && cards > 0 ? FORTRESS.x : null;
  scene.wallHeight = rows * (FORTRESS.height + 6);
  scene.calmGoal = local > FORTRESS_LASER - 0.8 && local < FORTRESS_DROP + 0.4 ? 0.6 : 0;
  for (let index = 0; index < cards; index++) {
    if (fortressBlockFall(local, index) >= 1 && flag(episode, 1 << index)) {
      const card = fortressCard(index);
      sparks(scene, card.x + FORTRESS.card / 2, card.y + FORTRESS.height, 3, 140, "#fff2c2");
    }
  }
  if (local >= FORTRESS_DROP && flag(episode, 1 << 20)) {
    explodeAt(scene, FORTRESS.x + 88, GROUND - 50, 16);
  }
}

function stepRain(scene: Scene, local: number) {
  if (local < 0.8 || local > 12.2 || scene.clock < scene.rainNext) return;
  scene.rainNext = scene.clock + 0.07;
  const cloud = rainCloudX(scene, local);
  const x = cloud + between(scene, -58, 58);
  const overTarget = local < RAIN_SWITCH + 0.6;
  const shield = overTarget && umbrellaOpen(local) > 0.5;
  const body = overTarget ? targetAt(scene) : sourceAt(scene);
  const center = shield ? body.x + 44 : body.x;
  const land = shield ? GROUND - 300 + body.y : GROUND - 156 + body.y;
  spawn(scene, {
    kind: "drop",
    x,
    y: 96,
    vy: 260,
    gravity: 900,
    life: 2,
    ty: Math.abs(x - center) < (shield ? 76 : 58) ? land : GROUND - 2,
    crit: shield,
    color: "#7fd0ff",
  });
}

function stepParty(scene: Scene, local: number, episode: Episode) {
  if (local >= PARTY_PULL && flag(episode, 1)) {
    scene.shake = Math.min(26, scene.shake + 4);
    spawn(scene, {
      kind: "ring",
      x: sourceAt(scene).x + 84,
      y: GROUND - 20,
      life: 0.3,
      size: 40,
      color: "#ffd8a8",
    });
  }
}
