import type { Locator, Page } from "playwright";

export async function measureAppClick(page: Page, target: Locator, readySelector: string) {
  const measurement = page.evaluate(
    (selector) =>
      new Promise<number>((resolve, reject) => {
        let started: number | null = null;
        let frame: number | null = null;
        const cleanup = () => {
          observer.disconnect();
          document.removeEventListener("click", start, true);
          if (frame !== null) cancelAnimationFrame(frame);
          clearTimeout(timeout);
        };
        const ready = () => {
          if (started === null || frame !== null || !document.querySelector(selector)) return;
          frame = requestAnimationFrame(() => {
            const elapsed = performance.now() - (started ?? performance.now());
            cleanup();
            resolve(elapsed);
          });
        };
        const start = () => {
          started = performance.now();
          ready();
        };
        const observer = new MutationObserver(ready);
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Interaction did not render ${selector}`));
        }, 5000);
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("click", start, { once: true, capture: true });
      }),
    readySelector,
  );
  const [duration, clicked] = await Promise.allSettled([measurement, target.click()]);
  if (clicked.status === "rejected") throw clicked.reason;
  if (duration.status === "rejected") throw duration.reason;
  return duration.value;
}

export function interactionPercentiles(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples,
    runs: samples.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}
