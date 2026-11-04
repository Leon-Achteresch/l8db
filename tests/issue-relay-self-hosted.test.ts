import { heapStats } from "bun:jsc";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import relay from "../services/issue-relay/src/index.js";
import {
  createHandler,
  createLimiter,
  createStorage,
} from "../services/issue-relay/src/self-hosted.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function storage(options = {}) {
  const path = await mkdtemp(join(tmpdir(), "l8db-relay-test-"));
  directories.push(path);
  return { path, store: await createStorage(path, options) };
}
const key = (number: number) => `${number}-00000000-0000-4000-8000-000000000000.png`;
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const report = (headers: Record<string, string> = {}, signal?: AbortSignal) =>
  new Request("https://relay.test/issues", {
    method: "POST",
    body: "{}",
    headers: { "content-length": "2", ...headers },
    signal,
  });

test("self-hosted storage persists images, refuses traversal and enforces quota and expiry", async () => {
  let now = Date.now();
  const { path, store } = await storage({ maxBytes: 16, maxFiles: 2, now: () => now });
  await store.put(key(1), png);
  await store.put(key(2), png);
  expect(store.stats).toEqual({ bytes: 16, files: 2, pending: 0 });
  await expect(store.put(key(3), png)).rejects.toThrow("budget");
  await expect(store.put("../secrets.pem", png)).rejects.toThrow("key");
  expect(store.get("../secrets.pem").status).toBe(404);
  const response = store.get(key(1));
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  expect((await createStorage(path)).get(key(1), true).status).toBe(200);
  now += 366 * 24 * 60 * 60 * 1000;
  expect(store.get(key(1)).status).toBe(404);
  await store.put(key(3), png);
  expect(store.stats).toEqual({ bytes: 8, files: 1, pending: 0 });
});

test("self-hosted adapter overrides spoofed client IP, bounds concurrency and releases cancellation", async () => {
  const { store } = await storage();
  const addresses: string[] = [];
  const handler = createHandler(
    { SCREENSHOTS: store },
    {
      trustProxy: true,
      maxConcurrent: 1,
      fetchRelay: async (request: Request) => {
        addresses.push(request.headers.get("cf-connecting-ip") ?? "");
        await new Promise<void>((resolve) =>
          request.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return new Response(null, { status: 499 });
      },
    },
  );
  const controller = new AbortController();
  const pending = handler.fetch(
    report(
      { "cf-connecting-ip": "spoofed", "x-forwarded-for": "198.51.100.1, 203.0.113.2" },
      controller.signal,
    ),
    "127.0.0.1",
  );
  expect(addresses).toEqual(["203.0.113.2"]);
  expect(handler.active).toBe(1);
  expect((await handler.fetch(report())).status).toBe(503);
  controller.abort();
  expect((await pending).status).toBe(499);
  expect(handler.active).toBe(0);
  expect((await handler.fetch(report({}, controller.signal))).status).toBe(499);
  expect((await handler.fetch(new Request("https://relay.test/health"))).status).toBe(200);
  expect((await handler.fetch(new Request("https://relay.test/unknown"))).status).toBe(404);
  expect((await handler.fetch(report({ "content-length": "4000001" }))).status).toBe(413);
  let address = "";
  const direct = createHandler(
    { SCREENSHOTS: store },
    {
      fetchRelay: async (request: Request) => {
        address = request.headers.get("cf-connecting-ip") ?? "";
        return new Response();
      },
    },
  );
  await direct.fetch(
    report({ "cf-connecting-ip": "spoofed", "x-forwarded-for": "203.0.113.99" }),
    "198.51.100.3",
  );
  expect(address).toBe("198.51.100.3");
});

test("self-hosted performance: 100k identities remain bounded, large uploads persist, idle does no work", async () => {
  let time = 0;
  const limiter = createLimiter({ capacity: 4096, now: () => time });
  const durations: number[] = [];
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 100_000; index++) {
    const start = performance.now();
    limiter.limit({ key: `ip-${index}` });
    durations.push(performance.now() - start);
  }
  expect(limiter.size).toBe(4096);
  expect(limiter.limit({ key: "overflow" }).success).toBe(false);
  time = 60_001;
  expect(limiter.limit({ key: "fresh" }).success).toBe(true);
  expect(limiter.size).toBe(1);
  expect(limiter.limit({ key: "fresh" }).success).toBe(true);
  expect(limiter.limit({ key: "fresh" }).success).toBe(true);
  expect(limiter.limit({ key: "fresh" }).success).toBe(false);
  durations.sort((a, b) => a - b);
  const median = durations[50_000] ?? Infinity;
  const p95 = durations[95_000] ?? Infinity;
  Bun.gc(true);
  const retained = heapStats().heapSize - before;
  expect(median).toBeLessThan(1);
  expect(p95).toBeLessThan(2);
  expect(retained).toBeLessThan(32 * 1024 * 1024);
  const { store } = await storage({ maxBytes: 24_000_000, maxFiles: 8 });
  const bytes = new Uint8Array(3_000_000);
  bytes.set(png);
  const start = performance.now();
  await Promise.all(Array.from({ length: 8 }, (_, index) => store.put(key(index), bytes)));
  const uploadMs = performance.now() - start;
  expect(uploadMs).toBeLessThan(3000);
  expect(store.stats).toEqual({ bytes: 24_000_000, files: 8, pending: 0 });
  await expect(store.put(key(9), bytes)).rejects.toThrow("budget");
  const idle = { ...store.stats };
  await Bun.sleep(30);
  expect(store.stats).toEqual(idle);
  console.log(
    JSON.stringify({
      identities: 100_000,
      maxBuckets: 4096,
      medianMs: median,
      p95Ms: p95,
      heapDeltaBytes: retained,
      concurrentUploads: 8,
      uploadBytes: 24_000_000,
      uploadMs,
      idleWrites: 0,
      databaseRequests: 0,
    }),
  );
});

test("worker decoder performance: eight full-size reports keep latency and GitHub calls bounded", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString(
    "base64",
  );
  const { store } = await storage();
  const env = {
    REPOSITORY: "Leon-Achteresch/l8db",
    SCREENSHOT_BASE_URL: "https://relay.test/screenshots",
    GITHUB_APP_ID: "1",
    GITHUB_INSTALLATION_ID: "2",
    GITHUB_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----`,
    LIMITER: { limit: () => ({ success: true }) },
    SCREENSHOTS: store,
  };
  let calls = 0;
  let issue = 0;
  let maxRss = process.memoryUsage().rss;
  const rssBefore = maxRss;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls++;
    maxRss = Math.max(maxRss, process.memoryUsage().rss);
    return Response.json(
      url.endsWith("/access_tokens")
        ? { token: "synthetic" }
        : { html_url: "https://github.com/Leon-Achteresch/l8db/issues/0", number: ++issue },
    );
  }) as typeof fetch;
  const bytes = Buffer.alloc(2_900_000);
  bytes.set(png);
  const payload = JSON.stringify({
    title: "Synthetic",
    body: "No real data",
    screenshot: bytes.toString("base64"),
  });
  const times: number[] = [];
  try {
    for (let batch = 0; batch < 2; batch++)
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          const start = performance.now();
          const response = await relay.fetch(
            new Request("https://relay.test/issues", {
              method: "POST",
              body: payload,
              headers: { "content-length": String(payload.length) },
            }),
            env,
          );
          times.push(performance.now() - start);
          expect(response.status).toBe(201);
        }),
      );
  } finally {
    globalThis.fetch = realFetch;
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      fullReports: 8,
      pngBytesEach: bytes.length,
      medianMs: times[4],
      p95Ms: times[7],
      githubRequests: calls,
      rssDeltaBytes: maxRss - rssBefore,
    }),
  );
  expect(times[7]).toBeLessThan(3000);
  expect(maxRss - rssBefore).toBeLessThan(128 * 1024 * 1024);
  expect(calls).toBe(24);
  expect(store.stats.files).toBe(8);
});
