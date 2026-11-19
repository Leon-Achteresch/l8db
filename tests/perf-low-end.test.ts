import { expect, test } from "bun:test";
import { trackScrolling } from "../src/lib/hooks/use-scrolling-flag";
import { hasNewFeatures, NEW_FEATURES, NEXT_FEATURE_VERSION } from "../src/lib/new-features";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

class TrackedTarget extends EventTarget {
  listeners = 0;
  writes = 0;
  attributes = new Set<string>();
  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    this.listeners++;
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    this.listeners--;
    super.removeEventListener(type, callback, options);
  }
  setAttribute(name: string) {
    this.writes++;
    this.attributes.add(name);
  }
  removeAttribute(name: string) {
    this.writes++;
    this.attributes.delete(name);
  }
}

test("20000 badge lookups per run scan only the current release", async () => {
  const scopes = [
    ...Object.keys(NEW_FEATURES).map((id) => id.split(".")[0]),
    "split.pane-tabs",
    "workspace.motion",
    "missing.scope",
  ];
  const seen = new Set<keyof typeof NEW_FEATURES>();
  const lookups = 20_000;
  let hits = 0;
  const timing = await measureScenario(() => {
    hits = 0;
    for (let index = 0; index < lookups; index++)
      if (hasNewFeatures(scopes[index % scopes.length], seen, NEXT_FEATURE_VERSION)) hits++;
  }, 11);
  reportScenario("new-feature-lookups", {
    lookups,
    features: Object.keys(NEW_FEATURES).length,
    hits,
    ...timing,
  });
  expect(hasNewFeatures("missing.scope", seen, NEXT_FEATURE_VERSION)).toBe(false);
  expect(hasNewFeatures(undefined, seen, NEXT_FEATURE_VERSION)).toBe(false);
  expect(timing.p95Ms).toBeLessThan(40);
});

test("10000 scroll events write the scrolling flag once and release everything when idle", async () => {
  const element = new TrackedTarget();
  const release = new TrackedTarget();
  const stop = trackScrolling(element as unknown as HTMLElement, release);
  const started = performance.now();
  for (let index = 0; index < 10_000; index++) element.dispatchEvent(new Event("scroll"));
  const elapsedMs = performance.now() - started;
  expect(element.writes).toBe(1);
  expect(element.attributes.has("data-scrolling")).toBe(true);

  await Bun.sleep(220);
  expect(element.attributes.has("data-scrolling")).toBe(false);
  expect(element.writes).toBe(2);

  element.dispatchEvent(new Event("scroll"));
  element.dispatchEvent(new Event("pointerdown"));
  expect(element.attributes.has("data-scrolling")).toBe(false);
  element.dispatchEvent(new Event("scroll"));
  expect(element.attributes.has("data-scrolling")).toBe(false);
  release.dispatchEvent(new Event("pointerup"));
  element.dispatchEvent(new Event("scroll"));
  expect(element.attributes.has("data-scrolling")).toBe(true);

  const writes = element.writes;
  stop();
  expect(element.attributes.has("data-scrolling")).toBe(false);
  expect(element.listeners + release.listeners).toBe(0);
  await Bun.sleep(220);
  expect(element.writes).toBe(writes + 1);
  reportScenario("grid-scrolling-flag", { events: 10_000, elapsedMs, writes: element.writes });
  expect(elapsedMs).toBeLessThan(200);
});

test("reduced motion starts no transition on elements without one", async () => {
  for (const path of ["src/index.css", "src/app/beautifui/foundation.css"]) {
    const css = await Bun.file(path).text();
    expect(css).not.toMatch(/transition-duration:\s*0\.01ms/);
    expect(css).toMatch(/transition-duration:\s*0s !important/);
  }
});
