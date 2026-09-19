import { TOUR_CHAPTERS } from "./data";

export function flattenTour() {
  return TOUR_CHAPTERS.flatMap((chapter, chapterIndex) =>
    chapter.steps.map((step, stepIndex) => ({ chapter, chapterIndex, step, stepIndex })),
  );
}

export function tourProgress(chapterIndex: number, stepIndex: number) {
  const done = TOUR_CHAPTERS.slice(0, chapterIndex).reduce(
    (sum, chapter) => sum + chapter.steps.length,
    0,
  );
  return {
    current: done + stepIndex + 1,
    total: flattenTour().length,
  };
}
