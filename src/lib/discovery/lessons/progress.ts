import type { Capabilities } from "@/lib/db";
import { featureAvailable } from "../catalog";
import type { FeatureEvent } from "../events";
import type { FeatureEntry } from "../types";
import type { Lesson, LessonCheck } from "./lessons";

export type LessonSignal = { feature: string } | { event: FeatureEvent };

export interface LessonProgress {
  step: number;
  done: boolean;
  at: number;
}

export function checkSatisfied(check: LessonCheck, signal: LessonSignal): boolean {
  if ("feature" in check) return "feature" in signal && signal.feature === check.feature;
  if (!("event" in signal) || signal.event.name !== check.event) return false;
  const where = check.where ?? {};
  for (const key in where) if (signal.event.data[key] !== where[key]) return false;
  return true;
}

export function advanceLesson(
  lesson: Lesson,
  progress: LessonProgress | undefined,
  signal: LessonSignal,
  now = Date.now(),
): LessonProgress | null {
  const current = progress ?? { step: 0, done: false, at: now };
  if (current.done) return null;
  const step = lesson.steps[current.step];
  if (!step || !checkSatisfied(step.check, signal)) return null;
  const next = current.step + 1;
  return next >= lesson.steps.length
    ? { step: lesson.steps.length, done: true, at: now }
    : { step: next, done: false, at: now };
}

export function lessonAvailable(
  lesson: Lesson,
  capabilities: Capabilities | null | undefined,
): boolean {
  if (!lesson.capability) return true;
  return featureAvailable({ capability: lesson.capability } as FeatureEntry, { capabilities });
}

export function pruneLessonProgress(
  value: unknown,
  known: (id: string) => boolean,
): Record<string, LessonProgress> {
  const result: Record<string, LessonProgress> = {};
  if (!value || typeof value !== "object") return result;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!known(id) || !raw || typeof raw !== "object") continue;
    const { step, done, at } = raw as Partial<LessonProgress>;
    if (!Number.isInteger(step) || (step as number) < 0 || !Number.isFinite(at)) continue;
    result[id] = { step: step as number, done: done === true, at: at as number };
  }
  return result;
}
