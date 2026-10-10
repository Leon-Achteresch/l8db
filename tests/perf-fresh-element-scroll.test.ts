import { expect, test } from "bun:test";
import type { Virtualizer } from "@tanstack/react-virtual";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { createFreshElementScroll } from "../src/lib/fresh-element-scroll";

function fixture(horizontal = false) {
  const calls: { left?: number; top?: number; behavior?: ScrollBehavior }[] = [];
  const element = {
    scrollTo: (options: (typeof calls)[number]) => calls.push(options),
    get scrollTop() {
      throw new Error("Synchronous scroll measurement");
    },
    get scrollHeight() {
      throw new Error("Synchronous layout measurement");
    },
  } as unknown as HTMLDivElement;
  const instance = {
    scrollElement: element,
    options: { horizontal },
  } as Virtualizer<HTMLDivElement, HTMLDivElement>;
  return { instance, calls };
}

test("fresh lists skip only their initial zero write and preserve later resets and adjustments", () => {
  const scroll = createFreshElementScroll<HTMLDivElement, HTMLDivElement>();
  const first = fixture();
  scroll(0, {}, first.instance);
  expect(first.calls).toEqual([]);
  scroll(72, {}, first.instance);
  scroll(0, {}, first.instance);
  scroll(12, { adjustments: 4, behavior: "auto" }, first.instance);
  expect(first.calls).toEqual([
    { top: 72, behavior: undefined },
    { top: 0, behavior: undefined },
    { top: 16, behavior: "auto" },
  ]);
  const next = fixture();
  scroll(0, {}, next.instance);
  expect(next.calls).toEqual([]);
  for (const [offset, options] of [
    [20, {}],
    [0, { adjustments: 10 }],
    [0, { behavior: "smooth" }],
  ] as const) {
    const restored = fixture(true);
    scroll(offset, options, restored.instance);
    expect(restored.calls).toEqual([
      {
        left: offset + ("adjustments" in options ? options.adjustments : 0),
        behavior: "behavior" in options ? options.behavior : undefined,
      },
    ]);
  }
  scroll(0, {}, { ...first.instance, scrollElement: null } as typeof first.instance);
});

test("10,000 fresh element setups avoid initial native scroll writes with bounded work", async () => {
  let writes = 0;
  const instances = Array.from(
    { length: 10_000 },
    () =>
      ({
        scrollElement: { scrollTo: () => writes++ },
        options: { horizontal: false },
      }) as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>,
  );
  const timing = await measureScenario(() => {
    const scroll = createFreshElementScroll<HTMLDivElement, HTMLDivElement>();
    writes = 0;
    for (const instance of instances) scroll(0, {}, instance);
    expect(writes).toBe(0);
    for (let index = 0; index < 40; index++) scroll(36, {}, instances[index]);
    expect(writes).toBe(40);
  });
  await reportScenario("palette-fresh-scroll", {
    ...timing,
    freshElements: instances.length,
    initialNativeWrites: 0,
    keyboardNativeWrites: writes,
    retainedElementReferences: "weak",
    databaseRequests: 0,
  });
  expect(timing.p95Ms).toBeLessThan(20);
});
