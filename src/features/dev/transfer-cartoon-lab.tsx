import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { drawScene } from "./transfer-cartoon-draw";
import {
  createScene,
  type Phase,
  phaseAt,
  type Scene,
  STAGE_H,
  STAGE_W,
  stepScene,
  TIMELINE,
} from "./transfer-cartoon-sim";

const PHASE_LABELS: Record<Phase, string> = {
  intro: "Auftritt",
  battle: "Beschuss & Namensraub",
  portal: "Portal öffnet sich",
  arrival: "Flaggschiff",
  charge: "Aufladen",
  barrage: "Sperrfeuer",
  boom: "DROP DATABASE",
  outro: "Abspann",
  done: "Fertig",
};

const JUMPS: { label: string; at: number }[] = [
  { label: "Start", at: 0 },
  { label: "Beschuss", at: TIMELINE.battle + 2 },
  { label: "Portal", at: TIMELINE.portal - 0.2 },
  { label: "Aufladen", at: TIMELINE.charge },
  { label: "Sperrfeuer", at: TIMELINE.barrage },
  { label: "Explosion", at: TIMELINE.boom - 0.6 },
  { label: "Abspann", at: TIMELINE.outro },
];

const button =
  "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
const input =
  "h-8 w-36 rounded-md border bg-background px-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function TransferCartoonLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [sourceName, setSourceName] = useState("staging_db");
  const [targetName, setTargetName] = useState("prod_shop");
  const [run, setRun] = useState({ id: 0, from: 0 });
  const [slow, setSlow] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loop, setLoop] = useState(true);
  const options = useRef({ slow, paused, loop });
  options.current = { slow, paused, loop };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const source = sourceName.trim() || "quelle";
    const target = (targetName.trim() || "ziel").slice(0, 16);
    const fresh = () => createScene(source, target, run.id + 7);
    let scene: Scene = fresh();
    while (scene.t < run.from) stepScene(scene, 1 / 60);
    let frame = 0;
    let last = performance.now();
    let phase: Phase | null = null;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const tick = (now: number) => {
      const { slow, paused, loop } = options.current;
      const dt = Math.min(0.05, (now - last) / 1000) * (slow ? 0.3 : 1);
      last = now;
      if (!paused) stepScene(scene, dt);
      if (loop && scene.t > TIMELINE.done + 1) scene = fresh();
      ctx.setTransform(canvas.width / STAGE_W, 0, 0, canvas.height / STAGE_H, 0, 0);
      drawScene(ctx, scene);
      const next = phaseAt(scene.t);
      if (next !== phase && phaseRef.current) {
        phase = next;
        phaseRef.current.textContent = PHASE_LABELS[next];
      }
      if (timeRef.current) timeRef.current.textContent = `${scene.t.toFixed(1)} s`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [run, sourceName, targetName]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Transfer als Animation</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Die Quelle klaut dem Ziel Buchstabe für Buchstabe den Namen und beschießt es mit
            Tabellen, Zeilen und JSON. Zum Schluss kommt das Flaggschiff durchs Portal und macht
            kurzen Prozess.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            aria-label="Name der Quelle"
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            className={input}
          />
          <span className="text-muted-foreground">klaut</span>
          <input
            aria-label="Name des Ziels"
            value={targetName}
            maxLength={16}
            onChange={(event) => setTargetName(event.target.value)}
            className={input}
          />
          <button
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
            className={cn(button, paused && "bg-muted")}
          >
            Pause
          </button>
          <button
            type="button"
            aria-pressed={slow}
            onClick={() => setSlow(!slow)}
            className={cn(button, slow && "bg-muted")}
          >
            Zeitlupe
          </button>
          <button
            type="button"
            aria-pressed={loop}
            onClick={() => setLoop(!loop)}
            className={cn(button, loop && "bg-muted")}
          >
            Schleife
          </button>
          <button
            type="button"
            onClick={() => setRun({ id: run.id + 1, from: 0 })}
            className={button}
          >
            Neu starten
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Animation eines laufenden Transfers"
        className="block aspect-video w-full rounded-xl border bg-[#efe9a8]"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span ref={phaseRef} className="font-medium" />
          <span ref={timeRef} className="font-mono tabular-nums text-muted-foreground" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Springen zu</span>
          {JUMPS.map((jump) => (
            <button
              key={jump.label}
              type="button"
              onClick={() => setRun({ id: run.id + 1, from: jump.at })}
              className={button}
            >
              {jump.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
