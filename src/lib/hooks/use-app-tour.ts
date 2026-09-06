import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useConnectionsStore } from "@/lib/connections";
import { TOUR_CHAPTERS } from "@/lib/tour/chapters";
import {
  clickSelector,
  firstTableTarget,
  isWaitMet,
  nextTourPosition,
  prevTourPosition,
  shouldSkipStep,
  waitForSelector,
} from "@/lib/tour/conditions";
import { destroySpotlight, showSpotlight } from "@/lib/tour/spotlight";
import { currentTour, useTourStore } from "@/lib/tour/store";
import { useTransactionStore } from "@/lib/transactions";
import type { TourStep } from "@/lib/tour/types";

async function goToStepRoute(step: TourStep, navigate: ReturnType<typeof useNavigate>) {
  if (step.tableRoute) {
    const table = firstTableTarget();
    const schema = table?.dataset.schema;
    const name = table?.dataset.name;
    if (schema && name) {
      await navigate({ to: "/tables/$schema/$table", params: { schema, table: name } });
      return;
    }
  }
  if (step.route) {
    await navigate({ to: step.route as never });
  }
}

export function useAppTour() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = useTourStore((s) => s.active);
  const chapterIndex = useTourStore((s) => s.chapterIndex);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const autoPilot = useTourStore((s) => s.autoPilot);
  const waiting = useTourStore((s) => s.waiting);
  const generation = useRef(0);

  useEffect(() => {
    if (!active) {
      destroySpotlight();
      return;
    }
    const token = ++generation.current;
    let cancelled = false;
    const step = TOUR_CHAPTERS[chapterIndex]?.steps[stepIndex];
    if (!step) return;

    async function present() {
      if (shouldSkipStep(step!.skipIf)) {
        const nxt = nextTourPosition(chapterIndex, stepIndex);
        if (nxt) useTourStore.getState().setPosition(nxt.chapterIndex, nxt.stepIndex);
        else useTourStore.getState().stop();
        return;
      }
      if (step!.openTx) useTransactionStore.getState().setPanelOpen(true);
      await goToStepRoute(step!, navigate);
      if (cancelled || generation.current !== token) return;
      if (step!.target) await waitForSelector(step!.target, 5000);
      if (cancelled || generation.current !== token) return;
      if (autoPilot && step!.autoClick) {
        await new Promise((r) => window.setTimeout(r, 280));
        clickSelector(step!.autoClick);
        await waitForSelector(step!.target ?? step!.autoClick, 2500);
      }
      if (cancelled || generation.current !== token) return;
      const baseline = useConnectionsStore.getState().connections.length;
      useTourStore.getState().setClickDone(false);
      if (step!.wait) {
        useTourStore.getState().setWaiting(true, step!.waitHint ?? "Warten…", baseline);
        if (step!.wait.type === "click" && step!.wait.selector) {
          const el = document.querySelector(step!.wait.selector);
          const onClick = () => useTourStore.getState().setClickDone(true);
          el?.addEventListener("click", onClick, { once: true });
        }
      } else {
        useTourStore.getState().setWaiting(false, null);
      }
      showSpotlight(step!, Boolean(step!.wait));
    }

    void present();
    return () => {
      cancelled = true;
    };
  }, [active, chapterIndex, stepIndex, autoPilot, navigate]);

  useEffect(() => {
    if (!active || !waiting) return;
    const { step } = currentTour();
    if (!step?.wait) return;
    const baseline = useTourStore.getState().waitBaseline;
    const tick = () => {
      const clickDone = useTourStore.getState().clickDone;
      const path = window.location.pathname;
      if (!isWaitMet(step.wait!, baseline, clickDone, path)) return;
      useTourStore.getState().setWaiting(false, null);
      showSpotlight(step, false);
      if (useTourStore.getState().autoPilot) {
        window.setTimeout(() => advanceTour(), 400);
      }
    };
    const unsub = useConnectionsStore.subscribe(tick);
    const timer = window.setInterval(tick, 200);
    tick();
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [active, waiting, chapterIndex, stepIndex, pathname]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        target?.closest("input, textarea, [contenteditable], [role=combobox], [role=listbox]")
      )
        return;
      if (event.key === "Escape") {
        useTourStore.getState().stop();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        advanceTour();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        rewindTour();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  useEffect(() => {
    return () => destroySpotlight();
  }, []);
}

export function advanceTour() {
  const { chapter, chapterIndex, stepIndex } = currentTour();
  if (chapter && stepIndex === chapter.steps.length - 1) {
    useTourStore.getState().markChapterDone(chapter.id);
  }
  const nxt = nextTourPosition(chapterIndex, stepIndex);
  if (!nxt) {
    if (chapter) useTourStore.getState().markChapterDone(chapter.id);
    useTourStore.getState().stop();
    destroySpotlight();
    return;
  }
  useTourStore.getState().setPosition(nxt.chapterIndex, nxt.stepIndex);
}

export function rewindTour() {
  const { chapterIndex, stepIndex } = currentTour();
  const prev = prevTourPosition(chapterIndex, stepIndex);
  if (prev) useTourStore.getState().setPosition(prev.chapterIndex, prev.stepIndex);
}

export function jumpTourChapter(chapterIndex: number) {
  useTourStore.getState().setPosition(chapterIndex, 0);
}
