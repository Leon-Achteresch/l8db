import { afterAll, beforeAll, expect, test } from "bun:test";
import { animateChange } from "../src/lib/change-animation";

class TrackedTarget extends EventTarget {
  listeners = new Set<EventListenerOrEventListenerObject>();
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null) {
    if (callback) this.listeners.add(callback);
    super.addEventListener(type, callback);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null) {
    if (callback) this.listeners.delete(callback);
    super.removeEventListener(type, callback);
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const preference = Object.assign(new TrackedTarget(), { matches: false });
const doc = Object.assign(new TrackedTarget(), { visibilityState: "visible" });
const animations: {
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  cancel: () => void;
  cancelled: boolean;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
}[] = [];
const element = {
  animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = {
      onfinish: null,
      oncancel: null,
      cancelled: false,
      frames,
      options,
      cancel() {
        this.cancelled = true;
      },
    };
    animations.push(animation);
    return animation;
  },
} as unknown as HTMLElement;

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => preference },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
});

afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

test("completion, cancellation, hidden windows and preference changes release all work", () => {
  const stop = animateChange(element);
  const first = animations.at(-1)!;
  expect(doc.listeners.size).toBe(1);
  first.onfinish?.();
  expect(first.cancelled).toBe(true);
  expect(first.onfinish).toBeNull();
  expect(doc.listeners.size + preference.listeners.size).toBe(0);
  stop();

  animateChange(element);
  preference.dispatchEvent(new Event("change"));
  expect(animations.at(-1)!.cancelled).toBe(true);
  expect(doc.listeners.size + preference.listeners.size).toBe(0);

  animateChange(element);
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(doc.listeners.size + preference.listeners.size).toBe(0);
  const count = animations.length;
  animateChange(element)();
  expect(animations.length).toBe(count);
  doc.visibilityState = "visible";

  animateChange(element);
  animations.at(-1)!.oncancel?.();
  expect(doc.listeners.size + preference.listeners.size).toBe(0);
});

test("reduced motion keeps brief opacity feedback with no spatial movement", () => {
  preference.matches = true;
  const stop = animateChange(element, "section");
  const animation = animations.at(-1)!;
  expect(animation.frames.every((frame) => frame.transform === undefined)).toBe(true);
  expect(animation.options.duration).toBe(100);
  stop();
  preference.matches = false;
  animateChange({} as HTMLElement)();
});
