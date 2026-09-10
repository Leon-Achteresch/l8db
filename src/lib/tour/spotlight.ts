import { type Driver, driver } from "driver.js";
import type { TourStep } from "@/lib/tour/types";

let instance: Driver | null = null;

export function destroySpotlight() {
  instance?.destroy();
  instance = null;
  document.querySelectorAll("[data-tour-wait]").forEach((el) => {
    el.removeAttribute("data-tour-wait");
  });
}

function keepPopoverClearOfOverview() {
  const popover = document.querySelector<HTMLElement>(".driver-popover");
  const overview = document.querySelector<HTMLElement>('[data-tour-ui="overview"]');
  if (!popover || !overview) return;
  const p = popover.getBoundingClientRect();
  const o = overview.getBoundingClientRect();
  const overlaps = p.left < o.right && p.right > o.left && p.top < o.bottom && p.bottom > o.top;
  if (!overlaps) return;
  const gap = 16;
  const fitsRight = o.right + gap + p.width <= window.innerWidth;
  if (fitsRight) {
    popover.style.left = `${o.right + gap}px`;
    popover.style.right = "auto";
    return;
  }
  popover.style.top = `${Math.max(gap, o.top - gap - p.height)}px`;
  popover.style.bottom = "auto";
}

export function showSpotlight(step: TourStep, waiting: boolean) {
  if (!instance) {
    instance = driver({
      animate: true,
      allowClose: false,
      overlayColor: "rgba(8, 10, 16, 0.62)",
      overlayOpacity: 0.62,
      stagePadding: 10,
      stageRadius: 14,
      popoverOffset: 14,
      showButtons: [],
      disableActiveInteraction: false,
      popoverClass: "l8db-driver",
      onHighlighted: keepPopoverClearOfOverview,
    });
  }
  document.querySelectorAll("[data-tour-wait]").forEach((el) => {
    el.removeAttribute("data-tour-wait");
  });
  const target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
  if (waiting && target) target.setAttribute("data-tour-wait", "true");
  const description =
    waiting && step.waitHint
      ? `${step.body}<p class="l8db-driver-wait">${step.waitHint}</p>`
      : step.body;
  const popover =
    !target || step.side === "over"
      ? { title: step.title, description, align: "center" as const }
      : {
          title: step.title,
          description,
          side: step.side,
          align: "start" as const,
        };
  if (target) {
    instance.highlight({ element: target, popover });
    return;
  }
  instance.highlight({ popover });
}
