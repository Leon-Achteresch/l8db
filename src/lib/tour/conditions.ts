import { useConnectionsStore } from "@/lib/connections";
import { TOUR_CHAPTERS } from "@/lib/tour/chapters";
import type { TourSkipIf, TourWait } from "@/lib/tour/types";

export function nextTourPosition(chapterIndex: number, stepIndex: number) {
  const chapter = TOUR_CHAPTERS[chapterIndex];
  if (!chapter) return null;
  if (stepIndex + 1 < chapter.steps.length) {
    return { chapterIndex, stepIndex: stepIndex + 1 };
  }
  if (chapterIndex + 1 < TOUR_CHAPTERS.length) {
    return { chapterIndex: chapterIndex + 1, stepIndex: 0 };
  }
  return null;
}

export function prevTourPosition(chapterIndex: number, stepIndex: number) {
  if (stepIndex > 0) return { chapterIndex, stepIndex: stepIndex - 1 };
  if (chapterIndex > 0) {
    const prev = TOUR_CHAPTERS[chapterIndex - 1];
    return { chapterIndex: chapterIndex - 1, stepIndex: prev.steps.length - 1 };
  }
  return null;
}

export function selectorExists(selector: string) {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(selector));
}

export function firstTableTarget() {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>("[data-tour='sidebar-table']");
}

export function shouldSkipStep(skipIf: TourSkipIf | undefined) {
  if (!skipIf) return false;
  const connections = useConnectionsStore.getState().connections.length;
  const active = Boolean(useConnectionsStore.getState().activeId);
  if (skipIf === "has-connection") return connections > 0;
  if (skipIf === "has-active") return active;
  if (skipIf === "no-connection") return !active;
  if (skipIf === "no-tables") return !firstTableTarget();
  if (skipIf === "editor-open") return selectorExists("[data-tour='connection-editor']");
  return false;
}

export function isWaitMet(wait: TourWait, baseline: number, clicked: boolean, pathname: string) {
  if (wait.type === "connection-added") {
    return useConnectionsStore.getState().connections.length > baseline;
  }
  if (wait.type === "active-connection") {
    return Boolean(useConnectionsStore.getState().activeId);
  }
  if (wait.type === "click") return clicked;
  if (wait.type === "route") return pathname.includes(wait.includes);
  return selectorExists(wait.selector);
}

export function clickSelector(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.click();
  return true;
}

export function waitForSelector(selector: string, timeoutMs = 4000) {
  return new Promise<boolean>((resolve) => {
    if (document.querySelector(selector)) {
      resolve(true);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (document.querySelector(selector)) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 80);
  });
}
