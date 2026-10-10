import { type RefObject, startTransition, useEffect, useState } from "react";

const INPUT_SETTLE_MS = 150;

type Slot = { grant: () => void; element: Element | null; release: boolean };

const queue: Slot[] = [];
let scheduled = false;
let lastInput = Number.NEGATIVE_INFINITY;

for (const type of ["scroll", "pointermove", "pointerdown", "keydown"])
  window.addEventListener(
    type,
    () => {
      lastInput = performance.now();
    },
    { capture: true, passive: true },
  );

function distance(slot: Slot) {
  if (slot.release) return Number.POSITIVE_INFINITY;
  if (!slot.element) return 0;
  const { top, bottom } = slot.element.getBoundingClientRect();
  return Math.max(0, top - window.innerHeight, -bottom);
}

function pump() {
  if (scheduled || queue.length === 0) return;
  scheduled = true;
  requestAnimationFrame(() =>
    setTimeout(() => {
      scheduled = false;
      let next: Slot | undefined;
      let nearest = Number.POSITIVE_INFINITY;
      for (const slot of queue) {
        const d = distance(slot);
        if (!next || d < nearest) {
          next = slot;
          nearest = d;
        }
      }
      if (next && (nearest === 0 || performance.now() - lastInput > INPUT_SETTLE_MS)) {
        queue.splice(queue.indexOf(next), 1);
        startTransition(next.grant);
      }
      requestAnimationFrame(pump);
    }),
  );
}

export function useChartSlot(
  enabled: boolean,
  ref?: RefObject<Element | null>,
  releaseWhenIdle = false,
) {
  const [ready, setReady] = useState(false);
  if (!enabled && ready && !releaseWhenIdle) setReady(false);

  useEffect(() => {
    if (enabled === ready) return;
    const slot = {
      grant: () => setReady(enabled),
      element: ref?.current ?? null,
      release: !enabled,
    };
    queue.push(slot);
    pump();
    return () => {
      const index = queue.indexOf(slot);
      if (index >= 0) queue.splice(index, 1);
    };
  }, [enabled, ready, ref]);

  return ready && (enabled || releaseWhenIdle);
}
