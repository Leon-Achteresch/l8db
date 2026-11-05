import { drawScene } from "./transfer-cinematic-draw";
import { createScene, type Phase, phaseAt, stepScene, TIMELINE } from "./transfer-cinematic-sim";
import type { CinematicVariant } from "./transfer-cinematic-variant";

const PHASE_LABELS: Record<Phase, string> = {
  intro: "Auftritt",
  battle: "Beschuss & Namensraub",
  gate: "Sprungtor öffnet sich",
  arrival: "Flaggschiff",
  charge: "Aufladen",
  barrage: "Sperrfeuer",
  boom: "DROP DATABASE",
  outro: "Abspann",
  done: "Fertig",
};

export const classicVariant: CinematicVariant = {
  id: "classic",
  label: "Klassik",
  description:
    "Die Quelle klaut dem Ziel Buchstabe für Buchstabe den Namen und beschießt es mit Tabellen, Zeilen und JSON. Das Ziel weicht aus und wirft mit NULL zurück, bis das Flaggschiff durchs Sprungtor kommt.",
  jumps: [
    { label: "Start", at: 0 },
    { label: "Beschuss", at: TIMELINE.battle + 2 },
    { label: "NULL-Bombe", at: 5.8 },
    { label: "Sprungtor", at: TIMELINE.gate - 0.2 },
    { label: "Sperrfeuer", at: TIMELINE.barrage },
    { label: "Explosion", at: TIMELINE.boom - 0.6 },
    { label: "Abspann", at: TIMELINE.outro },
  ],
  create(sourceName, targetName, seed) {
    const scene = createScene(sourceName, targetName, seed);
    return {
      time: () => scene.t,
      phase: () => PHASE_LABELS[phaseAt(scene.t)],
      finished: () => scene.t >= TIMELINE.done,
      step: (dt) => stepScene(scene, dt),
      draw: (ctx) => drawScene(ctx, scene),
    };
  },
};
