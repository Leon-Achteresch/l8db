import { startTransition, useEffect, useState } from "react";

const queue: (() => void)[] = [];
let scheduled = false;

function pump() {
  if (scheduled || queue.length === 0) return;
  scheduled = true;
  requestAnimationFrame(() =>
    setTimeout(() => {
      scheduled = false;
      const grant = queue.shift();
      if (grant) startTransition(grant);
      requestAnimationFrame(pump);
    }),
  );
}

export function useChartSlot(enabled: boolean) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || ready) return;
    const grant = () => setReady(true);
    queue.push(grant);
    pump();
    return () => {
      const index = queue.indexOf(grant);
      if (index >= 0) queue.splice(index, 1);
    };
  }, [enabled, ready]);

  return ready;
}
