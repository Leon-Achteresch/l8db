import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRelayServer } from "../src/http.js";
import { createHandler, createLimiter, createStorage } from "../src/self-hosted.js";

const key = (number) => `${number}-00000000-0000-4000-8000-000000000000.png`;
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "l8db-relay-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const failedWrite = async (path, data, options) => {
  await writeFile(path, data.subarray(0, 4), options);
  throw Object.assign(new Error("synthetic full disk"), { code: "ENOSPC" });
};

test("partial writes are removed before releasing quota; failed cleanup retains quota", async (t) => {
  const path = await directory(t);
  const store = await createStorage(path, { write: failedWrite });
  await assert.rejects(store.put(key(1), png), /full disk/);
  assert.deepEqual(await readdir(path), []);
  assert.deepEqual(store.stats, { bytes: 0, files: 0, pending: 0 });
  const blocked = await createStorage(path, {
    maxBytes: 8,
    write: failedWrite,
    remove: async () => {
      throw Object.assign(new Error("synthetic cleanup denied"), { code: "EACCES" });
    },
  });
  await assert.rejects(blocked.put(key(2), png), /full disk/);
  assert.deepEqual(blocked.stats, { bytes: 8, files: 1, pending: 0 });
  assert.equal((await stat(join(path, `${key(2)}.pending`))).size, 4);
  assert.equal(blocked.get(key(2)).status, 404);
  await assert.rejects(blocked.put(key(3), png), /cleanup denied/);
  const restarted = await createStorage(path);
  assert.deepEqual(restarted.stats, { bytes: 0, files: 0, pending: 0 });
  assert.deepEqual(await readdir(path), []);
});

test("dripping upload has a total deadline and releases its concurrency slot", async () => {
  let interval;
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      interval = setInterval(() => controller.enqueue(new Uint8Array([32])), 2);
    },
    cancel() {
      clearInterval(interval);
      canceled = true;
    },
  });
  const handler = createHandler(
    {},
    {
      maxConcurrent: 1,
      uploadTimeoutMs: 40,
      fetchRelay: async (request) => {
        await request.text().catch(() => {});
        return new Response();
      },
    },
  );
  try {
    const started = performance.now();
    const pending = handler.fetch(
      new Request("https://relay.test/issues", {
        method: "POST",
        body,
        duplex: "half",
        headers: { "content-length": "100000" },
      }),
    );
    const refused = await handler.fetch(
      new Request("https://relay.test/issues", {
        method: "POST",
        body: "{}",
        headers: { "content-length": "2" },
      }),
    );
    assert.equal(refused.status, 503);
    assert.equal((await pending).status, 408);
    assert.equal(canceled, true);
    assert.equal(handler.active, 0);
    assert.ok(performance.now() - started < 1000);
  } finally {
    clearInterval(interval);
  }
});

test("real HTTP disconnect and slow upload release slots; actual streamed bytes are bounded", async (t) => {
  let finished;
  const handler = createHandler(
    {},
    {
      uploadTimeoutMs: 60,
      fetchRelay: async (request) => {
        await request.text().catch(() => {});
        finished?.();
        return new Response();
      },
    },
  );
  const server = createRelayServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = server.address().port;
  for (const disconnect of [false, true]) {
    const completion = new Promise((resolve) => {
      finished = resolve;
    });
    await new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("upload never closed"));
      }, 1500);
      const interval = setInterval(() => {
        if (!socket.destroyed) socket.write(" ");
      }, 5);
      socket.on("connect", () => {
        socket.write(
          "POST /issues HTTP/1.1\r\nHost: relay.test\r\nContent-Length: 100000\r\n\r\n ",
        );
        if (disconnect) setTimeout(() => socket.destroy(), 15);
      });
      socket.on("error", () => {});
      socket.on("close", () => {
        clearTimeout(timer);
        clearInterval(interval);
        resolve();
      });
    });
    await completion;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(handler.active, 0);
  }
  const large = new Request("https://relay.test/issues", {
    method: "POST",
    body: new Uint8Array(4_000_001),
    headers: { "content-length": "2" },
  });
  assert.equal((await handler.fetch(large)).status, 413);
  assert.equal(handler.active, 0);
});

test("early rate-limit responses survive HTTP transport cleanup", async (t) => {
  const handler = createHandler(
    {},
    { fetchRelay: async () => Response.json({ error: "limited" }, { status: 429 }) },
  );
  const server = createRelayServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/issues`, {
    method: "POST",
    body: "{}",
    headers: { "content-length": "2" },
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "limited" });
  assert.equal(handler.active, 0);
});

test("Node performance: bounded identities and eight complete large synthetic reports at four-way concurrency", async (t) => {
  const limiter = createLimiter({ capacity: 4096, now: () => 0 });
  const samples = [];
  for (let index = 0; index < 100_000; index++) {
    const start = performance.now();
    limiter.limit({ key: `ip-${index}` });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  assert.equal(limiter.size, 4096);
  assert.ok(samples[95_000] < 2);
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
  const store = await createStorage(await directory(t));
  const handler = createHandler({
    REPOSITORY: "Leon-Achteresch/l8db",
    SCREENSHOT_BASE_URL: "https://relay.test/screenshots",
    GITHUB_APP_ID: "1",
    GITHUB_INSTALLATION_ID: "2",
    GITHUB_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----`,
    LIMITER: { limit: () => ({ success: true }) },
    SCREENSHOTS: store,
  });
  let calls = 0;
  let issue = 0;
  const rssBefore = process.memoryUsage().rss;
  let rssPeak = rssBefore;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls++;
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    return Response.json(
      url.endsWith("/access_tokens")
        ? { token: "synthetic" }
        : { html_url: "https://github.com/Leon-Achteresch/l8db/issues/0", number: ++issue },
    );
  };
  const bytes = Buffer.alloc(2_900_000);
  bytes.set(png);
  const payload = JSON.stringify({
    title: "Synthetic",
    body: "No real data",
    screenshot: bytes.toString("base64"),
  });
  const times = [];
  try {
    for (let batch = 0; batch < 2; batch++)
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          const start = performance.now();
          const response = await handler.fetch(
            new Request("https://relay.test/issues", {
              method: "POST",
              body: payload,
              headers: { "content-length": String(payload.length) },
            }),
          );
          times.push(performance.now() - start);
          assert.equal(response.status, 201);
        }),
      );
  } finally {
    globalThis.fetch = realFetch;
  }
  times.sort((a, b) => a - b);
  const idle = { ...store.stats };
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(store.stats, idle);
  console.log(
    JSON.stringify({
      runtime: process.version,
      identities: 100_000,
      maxBuckets: limiter.size,
      limiterMedianMs: samples[50_000],
      limiterP95Ms: samples[95_000],
      fullReports: 8,
      pngBytesEach: bytes.length,
      medianMs: times[4],
      p95Ms: times[7],
      rssDeltaBytes: rssPeak - rssBefore,
      githubRequests: calls,
      activeAfter: handler.active,
      idleWrites: 0,
      databaseRequests: 0,
    }),
  );
  assert.ok(times[7] < 3000);
  assert.ok(rssPeak - rssBefore < 128 * 1024 * 1024);
  assert.equal(calls, 24);
  assert.equal(store.stats.files, 8);
  assert.equal(handler.active, 0);
});
