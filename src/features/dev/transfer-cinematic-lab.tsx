import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { STAGE } from "./transfer-cinematic-variant";
import { CINEMATIC_VARIANTS } from "./transfer-cinematic-variants";

const button =
  "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
const input =
  "h-8 w-36 rounded-md border bg-background px-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function TransferCinematicLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [sourceName, setSourceName] = useState("staging_db");
  const [targetName, setTargetName] = useState("prod_shop");
  const [run, setRun] = useState({ id: 0, from: 0 });
  const [variantId, setVariantId] = useState(CINEMATIC_VARIANTS[0].id);
  const variant =
    CINEMATIC_VARIANTS.find((entry) => entry.id === variantId) ?? CINEMATIC_VARIANTS[0];
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
    const fresh = () => variant.create(source, target, run.id + 7);
    let scene = fresh();
    while (scene.time() < run.from) scene.step(1 / 60);
    let frame = 0;
    let last = performance.now();
    let phase = "";
    let doneFor = 0;

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
      if (!paused) scene.step(dt);
      doneFor = scene.finished() ? doneFor + dt : 0;
      if (loop && doneFor > 1) {
        scene = fresh();
        doneFor = 0;
      }
      ctx.setTransform(canvas.width / STAGE.width, 0, 0, canvas.height / STAGE.height, 0, 0);
      scene.draw(ctx);
      const next = scene.phase();
      if (next !== phase && phaseRef.current) {
        phase = next;
        phaseRef.current.textContent = next;
      }
      if (timeRef.current) timeRef.current.textContent = `${scene.time().toFixed(1)} s`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [run, sourceName, targetName, variant]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Transfer als Animation</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{variant.description}</p>
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
      {CINEMATIC_VARIANTS.length > 1 && (
        <fieldset className="flex flex-wrap items-center gap-1.5 text-xs">
          <legend className="sr-only">Variante</legend>
          {CINEMATIC_VARIANTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === variant.id}
              onClick={() => {
                setVariantId(entry.id);
                setRun({ id: run.id + 1, from: 0 });
              }}
              className={cn(button, entry.id === variant.id && "bg-muted font-medium")}
            >
              {entry.label}
            </button>
          ))}
        </fieldset>
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Animation eines laufenden Transfers"
        className="block aspect-video w-full rounded-xl border bg-[#f3e6d4]"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span ref={phaseRef} className="font-medium" />
          <span ref={timeRef} className="font-mono tabular-nums text-muted-foreground" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Springen zu</span>
          {variant.jumps.map((jump) => (
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
