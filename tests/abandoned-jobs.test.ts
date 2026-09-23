import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { runUntilAbandoned } from "../src/lib/queries/abandoned-jobs";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  const client = new QueryClient();
  const cancelled: string[] = [];
  let finish: (value: string) => void = () => undefined;
  const observer = new QueryObserver(client, {
    queryKey: ["rows", "a"],
    queryFn: (context) =>
      runUntilAbandoned(
        context,
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
        (jobId) => cancelled.push(jobId),
        30,
      ),
  });
  return { client, cancelled, observer, finish: (value: string) => finish(value) };
}

describe("abandoned row jobs", () => {
  test("a remount within the grace period keeps the running load and its result", async () => {
    const { client, cancelled, observer, finish } = setup();
    const stop = observer.subscribe(() => undefined);
    await wait(1);
    stop();
    const again = observer.subscribe(() => undefined);
    await wait(60);
    finish("rows");
    await wait(1);
    expect(cancelled).toEqual([]);
    expect(client.getQueryData(["rows", "a"])).toBe("rows");
    again();
    client.clear();
  });

  test("a load finishing shortly after unmounting is kept in the cache", async () => {
    const { client, cancelled, observer, finish } = setup();
    const stop = observer.subscribe(() => undefined);
    await wait(1);
    stop();
    await wait(10);
    finish("rows");
    await wait(1);
    expect(cancelled).toEqual([]);
    expect(client.getQueryData(["rows", "a"])).toBe("rows");
    client.clear();
  });

  test("a load nobody waits for beyond the grace period is cancelled on the server", async () => {
    const { client, cancelled, observer, finish } = setup();
    const stop = observer.subscribe(() => undefined);
    await wait(1);
    stop();
    await wait(60);
    expect(cancelled).toHaveLength(1);
    finish("late");
    await wait(1);
    expect(cancelled).toHaveLength(1);
    client.clear();
  });

  test("explicit cancellation stops the backend job immediately", async () => {
    const { client, cancelled, observer } = setup();
    const stop = observer.subscribe(() => undefined);
    await wait(1);
    await client.cancelQueries({ queryKey: ["rows", "a"] });
    expect(cancelled).toHaveLength(1);
    stop();
    client.clear();
  });
});
