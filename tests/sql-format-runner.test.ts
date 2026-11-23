import { afterEach, expect, test } from "bun:test";
import type { SqlFormatOptions } from "../src/lib/sql-format-options";
import { formatSqlInWorker } from "../src/lib/sql-format-runner";

const options: SqlFormatOptions = { dialect: "postgresql", tabWidth: 2, keywordCase: "upper" };
const originalWorker = globalThis.Worker;

type Message = { id: number; sql: string };
class TestWorker {
  static instances: TestWorker[] = [];
  posted: Message[] = [];
  terminated = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;

  constructor() {
    TestWorker.instances.push(this);
  }

  postMessage(message: Message) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  deliver(message: Message) {
    this.onmessage?.({
      data: { id: message.id, result: { ok: true, sql: message.sql.toUpperCase() } },
    });
  }
}

afterEach(() => {
  for (const worker of TestWorker.instances) {
    if (!worker.terminated) worker.onerror?.();
  }
  TestWorker.instances.length = 0;
  globalThis.Worker = originalWorker;
});

test("aborting a sole review discards the worker, drops its reply and makes the next review independent", async () => {
  globalThis.Worker = TestWorker as unknown as typeof Worker;
  const controller = new AbortController();
  const old = formatSqlInWorker("old", options, controller.signal);
  const worker = TestWorker.instances[0];
  controller.abort();
  await expect(old).rejects.toHaveProperty("name", "AbortError");
  expect(worker.terminated).toBe(true);

  const fresh = formatSqlInWorker("new", options);
  const next = TestWorker.instances[1];
  expect(next).not.toBe(worker);
  worker.deliver(worker.posted[0]);
  worker.onerror?.();
  next.deliver(next.posted[0]);
  expect(await fresh).toEqual({ ok: true, sql: "NEW" });
});

test("a cancelled format review leaves other editor formats on the shared worker intact", async () => {
  globalThis.Worker = TestWorker as unknown as typeof Worker;
  const controller = new AbortController();
  const classic = formatSqlInWorker("classic", options);
  const review = formatSqlInWorker("review", options, controller.signal);
  const worker = TestWorker.instances[0];
  controller.abort();
  await expect(review).rejects.toHaveProperty("name", "AbortError");
  expect(worker.terminated).toBe(false);
  worker.deliver(worker.posted[1]);
  worker.deliver(worker.posted[0]);
  expect(await classic).toEqual({ ok: true, sql: "CLASSIC" });
  expect(TestWorker.instances).toHaveLength(1);
});

test("an already-cancelled review never starts the worker", async () => {
  globalThis.Worker = TestWorker as unknown as typeof Worker;
  await expect(formatSqlInWorker("idle", options, AbortSignal.abort())).rejects.toHaveProperty(
    "name",
    "AbortError",
  );
  expect(TestWorker.instances).toHaveLength(0);
});
