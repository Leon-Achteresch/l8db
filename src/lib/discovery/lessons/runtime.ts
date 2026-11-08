import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import { isProduction } from "@/lib/environments";
import { startGuide, stopGuide } from "../guide";
import {
  activateDemoConnection,
  closeDemoDatabase,
  type DemoDatabaseDeps,
  openDemoDatabase,
} from "./demo-db";
import { lessonById } from "./lessons";
import { advanceLesson, type LessonSignal } from "./progress";
import { useLessonsStore } from "./store";

export const LESSON_ANCHOR_TIMEOUT_MS = 10_000;

function pause(): void {
  const { active, setActive } = useLessonsStore.getState();
  if (active && !active.paused) setActive({ ...active, paused: true });
}

function activeConnection() {
  const { connections, activeId } = useConnectionsStore.getState();
  return connections.find((connection) => connection.id === activeId) ?? null;
}

export function showLessonStep(): boolean {
  const { active, progress } = useLessonsStore.getState();
  const lesson = active && !active.paused ? lessonById(active.lessonId) : undefined;
  if (!active || !lesson) return false;
  if (isProduction(activeConnection())) {
    pause();
    toast("Lektion pausiert", { description: "Produktionsverbindung aktiv" });
    return false;
  }
  const index = progress[lesson.id]?.step ?? 0;
  const step = lesson.steps[index];
  if (!step) return false;
  return startGuide(`lesson.${lesson.id}`, {
    steps: [step],
    title: `${lesson.title} · ${index + 1}/${lesson.steps.length}`,
    advanceOnClick: false,
    allowNavigation: true,
    timeoutMs: LESSON_ANCHOR_TIMEOUT_MS,
    onEnd: (reason) => {
      if (reason !== "replaced" && reason !== "done") pause();
    },
  });
}

export function handleLessonSignal(signal: LessonSignal, now = Date.now()): boolean {
  const { active, progress, setProgress } = useLessonsStore.getState();
  const lesson = active ? lessonById(active.lessonId) : undefined;
  if (!active || !lesson) return false;
  if (useConnectionsStore.getState().activeId !== active.connectionId) return false;
  const next = advanceLesson(lesson, progress[lesson.id], signal, now);
  if (!next) return false;
  setProgress(lesson.id, next);
  if (next.done) {
    stopGuide();
    toast.success("Lektion geschafft", { description: lesson.title });
  } else if (!useLessonsStore.getState().active?.paused) showLessonStep();
  return true;
}

export async function startLesson(id: string, deps?: DemoDatabaseDeps): Promise<boolean> {
  const lesson = lessonById(id);
  if (!lesson) return false;
  const { active, progress, setActive, setProgress } = useLessonsStore.getState();
  const previousId = active ? active.previousId : useConnectionsStore.getState().activeId;
  let connectionId: string | null;
  try {
    connectionId = await openDemoDatabase(deps);
  } catch (error) {
    toast.error("Demo-Datenbank konnte nicht angelegt werden", {
      description: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  if (!connectionId) return false;
  if (progress[id]?.done) setProgress(id, { step: 0, done: false, at: Date.now() });
  setActive({ lessonId: id, connectionId, previousId, paused: false });
  showLessonStep();
  return true;
}

export async function resumeLesson(deps?: Pick<DemoDatabaseDeps, "activate">): Promise<boolean> {
  const { active, setActive } = useLessonsStore.getState();
  if (!active) return false;
  if (active.connectionId && !(await activateDemoConnection(active.connectionId, deps))) {
    if (useLessonsStore.getState().active === active) {
      setActive(null);
      stopGuide();
    }
    toast("Demo-Datenbank nicht mehr verfügbar", { description: "Lektion neu starten" });
    return false;
  }
  const current = useLessonsStore.getState().active;
  if (!current || current.lessonId !== active.lessonId) return false;
  setActive({ ...current, paused: false });
  return showLessonStep();
}

export async function endLesson(deps?: Pick<DemoDatabaseDeps, "activate">): Promise<void> {
  const { active, setActive } = useLessonsStore.getState();
  if (!active) return;
  setActive(null);
  stopGuide();
  await closeDemoDatabase(active.connectionId, active.previousId, deps);
}
