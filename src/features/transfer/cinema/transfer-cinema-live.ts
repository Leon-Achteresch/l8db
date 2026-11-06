import { EPISODE_KINDS, startEpisode, stepEpisode } from "./transfer-cinema-episodes";
import {
  between,
  createScene,
  HOLD,
  type Outcome,
  random,
  type Scene,
  type Speaker,
  stepScene,
  TIMELINE,
} from "./transfer-cinema-sim";

export type LiveInput = {
  progress: number;
  rows: number;
  table: string | null;
  outcome: Outcome;
};

const BANTER: [Speaker, string][][] = [
  [
    ["target", "Ich hab Foreign Keys! Und ich benutze sie!"],
    ["source", "Halt still. Ich will nur deine Zeilen."],
  ],
  [
    ["target", "Das verstößt gegen mindestens drei Constraints!"],
    ["source", "Constraints sind eher Vorschläge."],
  ],
  [
    ["target", "Ich ruf meinen DBA an!"],
    ["source", "Der ist seit 2019 im Urlaub."],
  ],
  [
    ["target", "Hast du überhaupt ein Backup?"],
    ["source", "Ich bin das Backup."],
  ],
  [
    ["target", "Mein Schema war handgeschrieben!"],
    ["source", "Sieht man."],
  ],
  [
    ["target", "Das hier ist Produktion!"],
    ["source", "Jetzt ja."],
  ],
  [
    ["target", "Ich habe Rechte! GRANT-Rechte!"],
    ["source", "REVOKE."],
  ],
  [
    ["target", "Wenn ich jetzt ROLLBACK sage …"],
    ["source", "… ist es schon committet."],
  ],
  [
    ["target", "Mir wird schwindlig. Ist das eine Migration?"],
    ["source", "Bleib locker. Nur ein kleiner JOIN."],
  ],
  [
    ["target", "Ich hatte mal eine Normalform. Die dritte!"],
    ["source", "Jetzt hast du keine mehr."],
  ],
];

export function shorten(name: string) {
  const clean = name.trim() || "datenbank";
  return clean.length > 16 ? `${clean.slice(0, 15)}…` : clean;
}

export function createLive(sourceName: string, targetName: string, seed = 7) {
  return createScene(shorten(sourceName), shorten(targetName), seed);
}

export function feedLive(scene: Scene, input: LiveInput) {
  scene.progress = Math.max(scene.progress, Math.min(1, Math.max(0, input.progress)));
  scene.liveRows = Math.max(scene.liveRows, input.rows);
  if (input.table && input.table !== scene.table) {
    scene.table = input.table;
    if (!scene.tables.includes(input.table)) {
      scene.tables.push(input.table);
      if (scene.tables.length > 12) scene.tables.shift();
    }
  }
  if (scene.outcome === "running" && input.outcome !== "running") {
    scene.outcome = input.outcome;
    scene.endedAt = scene.clock;
    scene.nextLetter = scene.clock + 0.6;
    scene.queue = [];
    scene.line = null;
    if (input.outcome === "failure") {
      for (const p of scene.particles) {
        if (p.kind !== "letter" || p.crit) continue;
        p.crit = true;
        p.tx = p.x;
        p.vy = p.y;
        p.age = 0;
      }
      scene.line = {
        from: scene.clock + 0.4,
        to: scene.clock + 4.2,
        speaker: "target",
        text: "ROLLBACK! Alles wie vorher. Ätsch.",
      };
    }
  }
}

function nextEpisodeKind(scene: Scene) {
  if (scene.bag.length === 0) {
    const bag = [...EPISODE_KINDS];
    for (let index = bag.length - 1; index > 0; index--) {
      const swap = Math.floor(random(scene) * (index + 1));
      [bag[index], bag[swap]] = [bag[swap], bag[index]];
    }
    if (bag[bag.length - 1] === scene.lastEpisode) bag.reverse();
    scene.bag = bag;
  }
  const kind = scene.bag.pop() ?? EPISODE_KINDS[0];
  scene.lastEpisode = kind;
  return kind;
}

export function stepLive(scene: Scene, dt: number) {
  const gap = scene.liveRows - scene.rows;
  scene.rows =
    gap > 0
      ? Math.min(scene.liveRows, Math.ceil(scene.rows + gap * (1 - Math.exp(-dt * 4))))
      : scene.liveRows;
  const idle = scene.outcome === "running" && scene.t >= HOLD;
  if (idle && !scene.episode && scene.clock >= scene.nextEpisode) {
    startEpisode(scene, nextEpisodeKind(scene));
  }
  stepEpisode(scene);
  if (!scene.episode && scene.nextEpisode <= scene.clock) {
    scene.nextEpisode = scene.clock + between(scene, 9, 13);
  }
  if (idle && !scene.episode && scene.clock >= scene.nextLine) {
    const pair = BANTER[scene.banter % BANTER.length];
    scene.banter++;
    for (let offset = 0; offset < pair.length; offset++) {
      const [speaker, text] = pair[offset];
      const from = scene.clock + offset * 2.6;
      scene.queue.push({ from, to: from + 2.3, speaker, text });
    }
    scene.nextLine = scene.clock + between(scene, 14, 20);
  }
  if (!scene.episode) {
    while (scene.queue.length > 0 && scene.queue[0].from <= scene.clock) {
      scene.line = scene.queue[0];
      scene.queue.shift();
    }
  }
  stepScene(scene, dt);
}

export function liveFinished(scene: Scene) {
  if (scene.outcome === "success") return scene.t >= TIMELINE.done;
  if (scene.outcome === "failure") {
    const since = scene.clock - scene.endedAt;
    return since > 12 || (since > 4.5 && scene.launched === 0);
  }
  return false;
}
