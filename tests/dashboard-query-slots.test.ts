import { describe, expect, test } from "bun:test";
import { withQuerySlot } from "../src/features/dashboard/query-slots";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("dashboard query slots", () => {
  test("runs at most the limit per connection, in order, and skips abandoned waiters", async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const job = (id: number) => async () => {
      started.push(id);
      peak = Math.max(peak, ++running);
      await wait(20);
      running--;
      return id;
    };
    const abandoned = new AbortController();
    const live = new AbortController().signal;
    const results = [
      withQuerySlot("ch", 2, live, job(1)),
      withQuerySlot("ch", 2, live, job(2)),
      withQuerySlot("ch", 2, abandoned.signal, job(3)),
      withQuerySlot("ch", 2, live, job(4)),
      withQuerySlot("ch", 2, live, job(5)),
      withQuerySlot("other", 2, live, job(6)),
    ];
    abandoned.abort();
    const settled = await Promise.allSettled(results);
    expect(settled[2].status).toBe("rejected");
    expect(settled.filter((r) => r.status === "fulfilled").length).toBe(5);
    expect(started).toEqual([1, 2, 6, 4, 5]);
    expect(peak).toBe(3);
    const before = performance.now();
    await withQuerySlot("ch", 2, live, job(7));
    expect(performance.now() - before).toBeLessThan(200);
  });

  test("a failing query frees its slot and no limit means no queue", async () => {
    const live = new AbortController().signal;
    await expect(
      withQuerySlot("fail", 1, live, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(await withQuerySlot("fail", 1, live, async () => "next")).toBe("next");
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        withQuerySlot("pg", 0, live, async () => {
          peak = Math.max(peak, ++running);
          await wait(5);
          running--;
        }),
      ),
    );
    expect(peak).toBe(5);
  });
});
