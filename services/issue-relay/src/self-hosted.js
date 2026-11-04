import { createReadStream } from "node:fs";
import { mkdir, opendir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import relay from "./index.js";

const MAX_BYTES = 4_000_000;
const KEY = /^\d+-[0-9a-f-]{36}\.png$/;
const YEAR = 365 * 24 * 60 * 60 * 1000;

export function createLimiter({ capacity = 4096, now = Date.now } = {}) {
  const buckets = new Map();
  return {
    get size() {
      return buckets.size;
    },
    limit({ key }) {
      const time = now();
      for (const [ip, bucket] of buckets) {
        if (bucket.until > time) break;
        buckets.delete(ip);
      }
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= capacity) return { success: false };
        bucket = { count: 0, until: time + 60_000 };
        buckets.set(key, bucket);
      }
      return { success: ++bucket.count <= 3 };
    },
  };
}

export async function createStorage(
  directory,
  {
    maxBytes = 512 * 1024 * 1024,
    maxFiles = 4096,
    now = Date.now,
    write = writeFile,
    remove = unlink,
  } = {},
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = new Map();
  let bytes = 0;
  let pending = 0;
  async function expire() {
    for (const [key, file] of files) {
      if (file.complete && file.time + YEAR > now()) continue;
      await remove(join(directory, key)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (files.delete(key)) bytes -= file.size;
    }
  }
  for await (const entry of await opendir(directory)) {
    const complete = KEY.test(entry.name);
    if (!entry.isFile() || (!complete && !KEY.test(entry.name.replace(/\.pending$/, "")))) continue;
    if (files.size >= maxFiles) throw new Error("Screenshot file budget exceeded");
    const file = await stat(join(directory, entry.name));
    files.set(entry.name, { size: file.size, time: file.mtimeMs, complete });
    bytes += file.size;
  }
  await expire();
  if (bytes > maxBytes) throw new Error("Screenshot storage budget exceeded");
  return {
    get stats() {
      return { bytes, files: files.size, pending };
    },
    async put(key, data) {
      if (!KEY.test(key)) throw new Error("Invalid screenshot key");
      await expire();
      if (
        files.has(key) ||
        files.has(`${key}.pending`) ||
        files.size + pending >= maxFiles ||
        bytes + data.byteLength > maxBytes
      )
        throw new Error("Screenshot storage budget exceeded");
      pending++;
      bytes += data.byteLength;
      const temporary = `${key}.pending`;
      try {
        await write(join(directory, temporary), data, { flag: "wx", mode: 0o600 });
        await rename(join(directory, temporary), join(directory, key));
        files.set(key, { size: data.byteLength, time: now(), complete: true });
      } catch (error) {
        let retained = false;
        if (error.code !== "EEXIST") {
          try {
            await remove(join(directory, temporary));
          } catch (cleanupError) {
            if (cleanupError.code !== "ENOENT") {
              files.set(temporary, { size: data.byteLength, time: now(), complete: false });
              retained = true;
            }
          }
        }
        if (!retained) bytes -= data.byteLength;
        throw error;
      } finally {
        pending--;
      }
    },
    get(key, head = false) {
      const file = files.get(key);
      if (!KEY.test(key) || !file?.complete || file.time + YEAR <= now())
        return new Response(null, { status: 404 });
      return new Response(head ? null : Readable.toWeb(createReadStream(join(directory, key))), {
        headers: {
          "content-type": "image/png",
          "content-length": String(file.size),
          "cache-control": "public, max-age=86400",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        },
      });
    },
  };
}

export function createHandler(
  env,
  {
    trustProxy = false,
    maxConcurrent = 4,
    uploadTimeoutMs = 15_000,
    fetchRelay = relay.fetch,
  } = {},
) {
  let active = 0;
  return {
    get active() {
      return active;
    },
    async fetch(request, peerAddress = "unknown") {
      const path = new URL(request.url).pathname;
      if ((request.method === "GET" || request.method === "HEAD") && path === "/health")
        return new Response(request.method === "HEAD" ? null : "ok");
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        path.startsWith("/screenshots/")
      )
        return env.SCREENSHOTS.get(path.slice("/screenshots/".length), request.method === "HEAD");
      if (request.method !== "POST" || path !== "/issues")
        return new Response(null, { status: 404 });
      if (request.signal.aborted) return new Response(null, { status: 499 });
      if (active >= maxConcurrent) return new Response(null, { status: 503 });
      const length = Number(request.headers.get("content-length") ?? MAX_BYTES + 1);
      if (!Number.isSafeInteger(length) || length < 1 || length > MAX_BYTES)
        return new Response(null, { status: 413 });
      const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
      const ip = trustProxy && forwarded && isIP(forwarded) ? forwarded : peerAddress;
      const headers = new Headers(request.headers);
      headers.set("cf-connecting-ip", ip);
      active++;
      const bounded = boundUpload(request, headers, uploadTimeoutMs);
      try {
        const response = await fetchRelay(bounded.request, env);
        return bounded.status ? new Response(null, { status: bounded.status }) : response;
      } finally {
        bounded.close();
        active--;
      }
    },
  };
}

function boundUpload(request, headers, timeoutMs) {
  const reader = request.body?.getReader();
  const abort = new AbortController();
  let streamController;
  let status = 0;
  let size = 0;
  const fail = (code) => {
    if (status) return;
    status = code;
    abort.abort();
    streamController?.error(new Error("Upload aborted"));
    reader?.cancel().catch(() => {});
  };
  const timer = setTimeout(() => fail(408), timeoutMs);
  timer.unref?.();
  const onAbort = () => fail(499);
  request.signal.addEventListener("abort", onAbort, { once: true });
  const body = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
    async pull(controller) {
      try {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) {
          clearTimeout(timer);
          controller.close();
          return;
        }
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) {
          fail(413);
          return;
        }
        controller.enqueue(chunk.value);
      } catch {
        fail(request.signal.aborted ? 499 : 400);
      }
    },
    cancel() {
      return reader?.cancel();
    },
  });
  return {
    request: new Request(request.url, {
      method: "POST",
      headers,
      body,
      duplex: "half",
      signal: abort.signal,
    }),
    get status() {
      return status;
    },
    close() {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      reader?.cancel().catch(() => {});
    },
  };
}

export async function loadEnvironment(environment = process.env) {
  const base = new URL(environment.PUBLIC_URL);
  if (
    base.protocol !== "https:" ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error("PUBLIC_URL must be an HTTPS origin");
  const key = await readFile(
    environment.GITHUB_APP_PRIVATE_KEY_FILE ?? "/run/secrets/github-app.pem",
    "utf8",
  );
  if (
    !environment.GITHUB_APP_ID ||
    !environment.GITHUB_INSTALLATION_ID ||
    !key.includes("BEGIN PRIVATE KEY")
  )
    throw new Error("GitHub App configuration missing");
  return {
    REPOSITORY: "Leon-Achteresch/l8db",
    SCREENSHOT_BASE_URL: `${base.origin}/screenshots`,
    GITHUB_APP_ID: environment.GITHUB_APP_ID,
    GITHUB_INSTALLATION_ID: environment.GITHUB_INSTALLATION_ID,
    GITHUB_APP_PRIVATE_KEY: key,
    LIMITER: createLimiter(),
    SCREENSHOTS: await createStorage(environment.SCREENSHOT_DIRECTORY ?? "/data/screenshots"),
  };
}
