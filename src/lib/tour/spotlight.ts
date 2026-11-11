import { create } from "zustand";
import { visibleElement } from "@/lib/tour/conditions";
import type { TourStep } from "@/lib/tour/types";

interface SpotlightState {
  selector: string | null;
  waiting: boolean;
}

export const useSpotlightStore = create<SpotlightState>()(() => ({
  selector: null,
  waiting: false,
}));

function clearWaitMarks() {
  document.querySelectorAll("[data-tour-wait]").forEach((el) => {
    el.removeAttribute("data-tour-wait");
  });
}

export function destroySpotlight() {
  clearWaitMarks();
  useSpotlightStore.setState({ selector: null, waiting: false });
}

export function showSpotlight(step: Pick<TourStep, "target" | "side">, waiting: boolean) {
  clearWaitMarks();
  const selector = step.target && step.side !== "over" ? step.target : null;
  if (selector && waiting) visibleElement(selector)?.setAttribute("data-tour-wait", "true");
  useSpotlightStore.setState({ selector, waiting: Boolean(selector) && waiting });
}
