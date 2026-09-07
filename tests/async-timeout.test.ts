import { describe, expect, test } from "bun:test";

const { withTimeout } = await import("../src/lib/async");

describe("withTimeout", () => {
  test("resolves the task result", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "timeout")).resolves.toBe(7);
  });
  test("passes task rejections through", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("db down")), 1000, "timeout"),
    ).rejects.toThrow("db down");
  });
  test("rejects after the deadline", async () => {
    const hanging = new Promise<string>(() => {});
    const started = Date.now();
    await expect(withTimeout(hanging, 50, "Zeitüberschreitung")).rejects.toThrow(
      "Zeitüberschreitung",
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });
  test("late task settlement stays handled", async () => {
    let rejectLate!: (error: Error) => void;
    const late = new Promise<string>((_, reject) => {
      rejectLate = reject;
    });
    await expect(withTimeout(late, 20, "too slow")).rejects.toThrow("too slow");
    rejectLate(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
