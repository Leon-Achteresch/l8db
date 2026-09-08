import { describe, expect, test } from "bun:test";
import { overviewVerticalOffset } from "../src/lib/tour/overview-position";

const panel = { top: 28, right: 334, bottom: 561, left: 5 };

describe("tour overview position", () => {
  test("moves the chapter panel above a covered target", () => {
    expect(
      overviewVerticalOffset({
        panel,
        currentOffset: 0,
        obstructions: [{ top: 490, right: 1700, bottom: 560, left: 0 }],
      }),
    ).toBe(-87);
  });

  test("keeps the panel in place when there is no collision", () => {
    expect(
      overviewVerticalOffset({
        panel,
        currentOffset: 0,
        obstructions: [{ top: 490, right: 700, bottom: 560, left: 350 }],
      }),
    ).toBe(0);
  });

  test("preserves the calculated position after the animation", () => {
    expect(
      overviewVerticalOffset({
        panel: { ...panel, top: -59, bottom: 474 },
        currentOffset: -87,
        obstructions: [{ top: 490, right: 1700, bottom: 560, left: 0 }],
      }),
    ).toBe(-87);
  });
});
