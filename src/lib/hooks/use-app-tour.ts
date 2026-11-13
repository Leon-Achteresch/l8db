import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useConnectionsStore } from "@/lib/connections";
import { featureSelector } from "@/lib/discovery/anchors";
import { featureAnchorId, featureById } from "@/lib/discovery/catalog";
import { TOUR_CHAPTERS } from "@/lib/tour/chapters";
import {
  clickSelector,
  firstTableTarget,
  isWaitMet,
  nextTourPosition,
  prevTourPosition,
  shouldSkipStep,
  visibleElement,
  waitForSelector,
} from "@/lib/tour/conditions";
import { destroySpotlight, showSpotlight } from "@/lib/tour/spotlight";
import { useTourStore } from "@/lib/tour/store";
import type { TourStep } from "@/lib/tour/types";
import { useTransactionStore } from "@/lib/transactions";

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

async function presentDetour(
  id: string,
  navigate: ReturnType<typeof useNavigate>,
  live: () => boolean,
) {
  const entry = featureById(id);
  if (!entry) return;
  if (entry.route && `${window.location.pathname}${window.location.search}` !== entry.route)
    await navigate({ href: entry.route });
  if (!live()) return;
  const selector = featureSelector(featureAnchorId(entry));
  const found = await waitForSelector(selector, 2500);
  if (!live()) return;
  const element = found ? visibleElement(selector) : null;
  element?.scrollIntoView?.({ block: "center", inline: "nearest" });
  showSpotlight({ target: element ? selector : undefined }, false);
}

function currentTour() {
  const { chapterIndex, stepIndex } = useTourStore.getState();
  const chapter = TOUR_CHAPTERS[chapterIndex];
  const step = chapter?.steps[stepIndex];
  return { chapter, step, chapterIndex, stepIndex };
}

export function useAppTour() {
  const navigate = useNavigate();
  const active = useTourStore((s) => s.active);
  const pathname = useRouterState({ select: (s) => (active ? s.location.pathname : "") });
  const chapterIndex = useTourStore((s) => s.chapterIndex);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const autoPilot = useTourStore((s) => s.autoPilot);
  const waiting = useTourStore((s) => s.waiting);
  const minimized = useTourStore((s) => s.minimized);
  const runId = useTourStore((s) => s.runId);
  const detour = useTourStore((s) => s.detour);
  const generation = useRef(0);

  useEffect(() => {
    if (!active || minimized) {
      destroySpotlight();
      return;
    }
    if (detour) {
      const token = ++generation.current;
      let cancelled = false;
      destroySpotlight();
      void presentDetour(detour, navigate, () => !cancelled && generation.current === token);
      return () => {
        cancelled = true;
      };
    }
    const step = TOUR_CHAPTERS[chapterIndex]?.steps[stepIndex];
    if (!step) return;
    if (useTourStore.getState().waiting) {
      showSpotlight(step, true);
      const { waitBaseline, clickDone } = useTourStore.getState();
      if (
        autoPilot &&
        step.autoClick &&
        step.wait &&
        !isWaitMet(step.wait, waitBaseline, clickDone, window.location.pathname)
      )
        clickSelector(step.autoClick);
      return;
    }
    const token = ++generation.current;
    let cancelled = false;

    async function present() {
      if (shouldSkipStep(step.skipIf)) {
        const nxt = nextTourPosition(chapterIndex, stepIndex);
        if (nxt) useTourStore.getState().setPosition(nxt.chapterIndex, nxt.stepIndex);
        else useTourStore.getState().stop();
        return;
      }
      if (step.openTx) useTransactionStore.getState().setPanelOpen(true);
      const back = useTourStore.getState().detourFrom;
      if (back) {
        useTourStore.setState({ detourFrom: null });
        await navigate({ href: back });
        if (cancelled || generation.current !== token) return;
      }
      await goToStepRoute(step, navigate);
      if (cancelled || generation.current !== token) return;
      const baseline = useConnectionsStore.getState().connections.length;
      const alreadyMet =
        Boolean(step.wait) && isWaitMet(step.wait!, baseline, false, window.location.pathname);
      const waitingNow = Boolean(step.wait) && !alreadyMet;
      showSpotlight(step, waitingNow);
      if (step.target) await waitForSelector(step.target, 900);
      if (cancelled || generation.current !== token) return;
      if (autoPilot && step.autoClick) {
        clickSelector(step.autoClick);
        await waitForSelector(step.target ?? step.autoClick, 1200);
      }
      if (cancelled || generation.current !== token) return;
      useTourStore.getState().setClickDone(false);
      if (waitingNow) {
        useTourStore.getState().setWaiting(true, step.waitHint ?? "Warten…", baseline);
        if (step.wait?.type === "click" && step.wait.selector) {
          const el = document.querySelector(step.wait.selector);
          const onClick = () => useTourStore.getState().setClickDone(true);
          el?.addEventListener("click", onClick, { once: true });
        }
        showSpotlight(step, true);
        return;
      }
      useTourStore.getState().setWaiting(false, null);
      showSpotlight(step, false);
    }

    void present();
    return () => {
      cancelled = true;
    };
  }, [active, minimized, chapterIndex, stepIndex, autoPilot, navigate, runId, detour]);

  useEffect(() => {
    if (!active || !waiting || minimized || detour) return;
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
  }, [active, minimized, waiting, chapterIndex, stepIndex, pathname, detour]);

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
        useTourStore.getState().setMinimized(true);
        return;
      }
      if (useTourStore.getState().minimized) return;
      if (useTourStore.getState().detour && ["ArrowRight", "ArrowLeft"].includes(event.key)) {
        event.preventDefault();
        useTourStore.getState().endDetour();
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
