const PROJECT = "abcdefghijklmnopqrst";
const ACCOUNT = "acct_deno_fixture";
const ACTOR = "3f2a7c1e-9b4d-4e8f-a1c2-0d9e8f7a6b5c";
const ORIGIN = "https://billing.example.test";
const SUPABASE = `https://${PROJECT}.supabase.co`;
const SECRET = "whsec_deno_fixture_never_remote";
const REQUEST = "deno-runtime-request-0001";
const encoder = new TextEncoder();
const fakeEnv = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role",
  SUPABASE_ANON_KEY: "fixture-anon",
  L8DB_STRIPE_SECRET_KEY: "sk_test_deno_fixture",
  L8DB_STRIPE_WEBHOOK_SECRET: SECRET,
  L8DB_STRIPE_ACCOUNT: ACCOUNT,
  L8DB_STRIPE_MODE: "test",
  L8DB_BILLING_PROJECT: PROJECT,
  L8DB_BILLING_ORIGIN: ORIGIN,
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
}

interface UpstreamCall {
  origin: string;
  path: string;
  method: string;
  bytes: number;
  idempotency: string | null;
}
interface NativeServer {
  kind: "webhook" | "checkout";
  server: Deno.HttpServer<Deno.NetAddr>;
  url: string;
  requests: number;
  inFlight: number;
  maxInFlight: number;
  chunked: number;
}

const upstreams: UpstreamCall[] = [];
const nativeServers: NativeServer[] = [];
const nativeFetch = globalThis.fetch;
const nativeServe = Deno.serve;
let loading: NativeServer["kind"] = "webhook";
let currentPrice: Record<string, unknown>;
let storageFailure = false;
let stripeFailure = false;
let oversizedPrice = false;
let oversizedResponseCancelled = false;
let customerId: string | null = null;
let customerCreations = 0;
let eventWrites = 0;
let lastCheckout = new URLSearchParams();
let lastPortal = new URLSearchParams();
const functionalChecks: string[] = [];

function validPrice() {
  return {
    id: "price_fixture",
    active: true,
    livemode: false,
    type: "recurring",
    metadata: { l8db_project: PROJECT },
    product: { id: "prod_fixture", active: true },
  };
}
currentPrice = validPrice();

function chunks(size: number, count: number, onCancel = () => {}) {
  let produced = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= count) controller.close();
      else {
        produced++;
        controller.enqueue(new Uint8Array(size));
      }
    },
    cancel: onCancel,
  });
  return { body, bytesProduced: () => produced * size };
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.hostname === "127.0.0.1" &&
    nativeServers.some((server) => new URL(server.url).port === url.port)
  )
    return nativeFetch(input, init);
  assert(
    url.origin === SUPABASE || url.origin === "https://api.stripe.com",
    `External network denied: ${url.origin}`,
  );
  const request = new Request(input, init);
  const body = await request.text();
  upstreams.push({
    origin: url.origin,
    path: url.pathname,
    method: request.method,
    bytes: encoder.encode(body).byteLength,
    idempotency: request.headers.get("idempotency-key"),
  });
  if (url.origin === SUPABASE) {
    if (url.pathname === "/auth/v1/user") {
      equal(request.headers.get("apikey"), fakeEnv.SUPABASE_ANON_KEY, "Auth uses anon key");
      return request.headers.get("authorization") === "Bearer fixture-user-jwt"
        ? Response.json({ id: ACTOR, email: "fixture@example.test" })
        : Response.json({ message: "invalid user" }, { status: 401 });
    }
    equal(
      request.headers.get("authorization"),
      `Bearer ${fakeEnv.SUPABASE_SERVICE_ROLE_KEY}`,
      "RPC service authorization",
    );
    const value = JSON.parse(body);
    equal(value.account, ACCOUNT, "RPC account scope");
    if (url.pathname === "/rest/v1/rpc/l8db_billing_apply_event") {
      if (storageFailure) return Response.json({ error: "storage down" }, { status: 503 });
      eventWrites++;
      return Response.json(true);
    }
    if (url.pathname === "/rest/v1/rpc/l8db_billing_customer") {
      equal(value.actor, ACTOR, "RPC user scope");
      if (value.stripe_customer && !customerId) customerId = value.stripe_customer;
      return Response.json(customerId);
    }
  } else {
    equal(
      request.headers.get("authorization"),
      `Bearer ${fakeEnv.L8DB_STRIPE_SECRET_KEY}`,
      "Stripe mock key",
    );
    equal(request.headers.get("stripe-version"), "2025-03-31.basil", "Pinned Stripe API version");
    if (url.pathname === "/v1/prices/price_fixture") {
      equal(url.searchParams.get("expand[]"), "product", "Price expands product");
      if (oversizedPrice)
        return new Response(
          chunks(8192, 256, () => {
            oversizedResponseCancelled = true;
          }).body,
        );
      return Response.json(currentPrice);
    }
    if (url.pathname === "/v1/customers") {
      customerCreations++;
      const fields = new URLSearchParams(body);
      equal(fields.get("metadata[supabase_user_id]"), ACTOR, "Customer user metadata");
      equal(fields.get("metadata[l8db_project]"), PROJECT, "Customer project metadata");
      return Response.json({ id: "cus_deno_fixture" });
    }
    if (url.pathname === "/v1/checkout/sessions") {
      lastCheckout = new URLSearchParams(body);
      if (stripeFailure)
        return Response.json(
          { error: { message: fakeEnv.L8DB_STRIPE_SECRET_KEY } },
          { status: 500 },
        );
      return Response.json({
        id: "cs_fixture",
        url: "https://checkout.stripe.com/c/pay/cs_fixture",
      });
    }
    if (url.pathname === "/v1/billing_portal/sessions") {
      lastPortal = new URLSearchParams(body);
      return Response.json({ url: "https://billing.stripe.com/p/session/fixture" });
    }
  }
  throw new Error(`Unexpected upstream ${request.method} ${url.pathname}`);
};

Deno.serve = ((handler: Deno.ServeHandler<Deno.NetAddr>) => {
  assert(typeof handler === "function", "Product registers its original handler");
  const metrics = { kind: loading, requests: 0, inFlight: 0, maxInFlight: 0, chunked: 0 };
  const server = nativeServe(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request, info) => {
      metrics.requests++;
      metrics.inFlight++;
      metrics.maxInFlight = Math.max(metrics.maxInFlight, metrics.inFlight);
      if (request.body && !request.headers.has("content-length")) metrics.chunked++;
      try {
        return await handler(request, info);
      } finally {
        metrics.inFlight--;
      }
    },
  );
  nativeServers.push(
    Object.assign(metrics, { server, url: `http://127.0.0.1:${server.addr.port}` }),
  );
  return server;
}) as typeof Deno.serve;

for (const [key, value] of Object.entries(fakeEnv)) Deno.env.set(key, value);

async function signature(body: string, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)),
  );
  const value = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${"0".repeat(64)},v1=${value}`;
}

function event(
  id = "evt_deno",
  object: Record<string, unknown> = {},
  patch: Record<string, unknown> = {},
  padding = "",
) {
  return JSON.stringify(
    {
      id,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object: { id: "sub_fixture", metadata: { l8db_project: PROJECT }, ...object } },
      padding,
      ...patch,
    },
    null,
    2,
  );
}

async function exchange(
  kind: NativeServer["kind"],
  body: BodyInit | null,
  headers: Record<string, string> = {},
  method = "POST",
) {
  const server = nativeServers.find((item) => item.kind === kind);
  assert(server, `Native ${kind} server exists`);
  const response = await fetch(server.url, {
    method,
    body: method === "POST" ? body : undefined,
    headers: {
      ...(kind === "checkout"
        ? {
            origin: ORIGIN,
            authorization: "Bearer fixture-user-jwt",
            "content-type": "application/json",
          }
        : {}),
      ...headers,
    },
  });
  const text = await response.text();
  assert(encoder.encode(text).byteLength < 4096, "Local response bytes stay bounded");
  return { status: response.status, text, headers: response.headers };
}

async function hook(body: string, header?: string) {
  return exchange("webhook", body, { "stripe-signature": header ?? (await signature(body)) });
}
function billing(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return exchange("checkout", JSON.stringify(body), headers, method);
}

await run();

async function run() {
  try {
    const webhook = await import("../../src-tauri/src/payments/webhook.ts");
    loading = "checkout";
    const checkout = await import("../../src-tauri/src/payments/checkout.ts");
    Deno.serve = nativeServe;
    equal(nativeServers.length, 2, "Both product files start native servers");
    await functional(webhook.readLimited, checkout.readLimited);
    await performanceChecks();
  } finally {
    Deno.serve = nativeServe;
    globalThis.fetch = nativeFetch;
    await Promise.all(nativeServers.map(({ server }) => server.shutdown()));
    for (const key of Object.keys(fakeEnv)) Deno.env.delete(key);
  }
}

async function functional(
  readWebhook: (
    stream: ReadableStream<Uint8Array> | null,
    limit: number,
  ) => Promise<Uint8Array | null>,
  readCheckout: (
    stream: ReadableStream<Uint8Array> | null,
    limit: number,
  ) => Promise<Uint8Array | null>,
) {
  const raw = `${event("evt_rawutf8", {}, {}, "München 💾")}\n`;
  const rawSignature = await signature(raw);
  equal((await hook(raw, rawSignature)).status, 200, "UTF-8 raw HMAC accepted");
  equal(eventWrites, 1, "Valid event reaches scoped storage once");
  const beforeInvalid = upstreams.length;
  equal((await hook(`${raw} `, rawSignature)).status, 400, "Raw-byte mutation rejected");
  equal(
    (await hook(raw, await signature(raw, undefined, "wrong-secret"))).status,
    400,
    "Wrong HMAC rejected",
  );
  equal(
    (await hook(raw, await signature(raw, Math.floor(Date.now() / 1000) - 600))).status,
    400,
    "Expired signature rejected",
  );
  equal(
    (await hook(raw, await signature(raw, Math.floor(Date.now() / 1000) + 600))).status,
    400,
    "Future signature rejected",
  );
  equal((await hook(raw, "t=invalid,v1=abc")).status, 400, "Malformed signature rejected");
  equal(upstreams.length, beforeInvalid, "Invalid signatures cause no upstream request");
  functionalChecks.push(
    "native WebCrypto HMAC over exact UTF-8 bytes, rotation candidates, tamper, expiry, future and malformed rejection",
  );

  const ignoredAt = upstreams.length;
  equal(
    (await hook(event("evt_foreign", { metadata: { l8db_project: "foreign" } }))).text,
    "ignored",
    "Foreign project ignored",
  );
  equal(
    (await hook(event("evt_unknown", {}, { type: "charge.refunded" }))).text,
    "ignored",
    "Unsupported event ignored",
  );
  equal(
    (await hook(event("evt_live", {}, { livemode: true }))).status,
    400,
    "Wrong Stripe mode rejected",
  );
  equal(upstreams.length, ignoredAt, "Ignored events cause no storage requests");
  equal(
    (
      await hook(
        event(
          "evt_invoice",
          {
            id: "in_fixture",
            metadata: {},
            parent: { subscription_details: { metadata: { l8db_project: PROJECT } } },
          },
          { type: "invoice.paid" },
        ),
      )
    ).status,
    200,
    "Invoice project mapping accepted",
  );
  storageFailure = true;
  equal((await hook(event("evt_storage"))).status, 503, "Storage failure stays retryable");
  storageFailure = false;
  functionalChecks.push(
    "project, invoice-parent, Stripe-mode gates and retryable webhook storage failure",
  );

  const beforeStreams = upstreams.length;
  const webhookStream = chunks(8192, 129);
  equal(
    (await exchange("webhook", webhookStream.body, { "stripe-signature": rawSignature })).status,
    413,
    "Actual chunked webhook exceeds 1MiB",
  );
  assert(webhookStream.bytesProduced() <= 8192 * 129, "Webhook upload bytes bounded");
  const checkoutStream = chunks(1024, 8);
  equal(
    (await exchange("checkout", checkoutStream.body)).status,
    413,
    "Actual chunked checkout exceeds 4096 bytes",
  );
  assert(checkoutStream.bytesProduced() <= 8192, "Checkout upload bytes bounded");
  equal(upstreams.length, beforeStreams, "Oversized chunked HTTP requests never reach upstreams");
  assert(
    nativeServers.every((server) => server.chunked >= 1),
    "Both servers observe streams without Content-Length",
  );
  for (const read of [readWebhook, readCheckout]) {
    let cancelled = false;
    const source = chunks(1024, 8, () => {
      cancelled = true;
    });
    equal(await read(source.body, 4096), null, "Native stream limit returns no partial payload");
    assert(cancelled, "Native ReadableStream is cancelled at limit");
    assert(source.bytesProduced() <= 8192, "Native reader allocations bounded");
  }
  functionalChecks.push(
    "real chunked HTTP size rejection and native stream reader cancellation without partial payloads",
  );

  const checkoutInput = { action: "checkout", price: "price_fixture", requestId: REQUEST };
  const portalInput = { action: "portal", requestId: REQUEST };
  const beforeGates = upstreams.length;
  equal((await billing(portalInput, {}, "OPTIONS")).status, 204, "CORS preflight");
  equal((await billing(portalInput, {}, "GET")).status, 405, "Checkout method gate");
  equal((await exchange("webhook", null, {}, "GET")).status, 405, "Webhook method gate");
  equal(
    (await billing(portalInput, { origin: "https://foreign.example.test" })).status,
    403,
    "Origin gate",
  );
  for (const authorization of [
    "",
    `Bearer ${fakeEnv.SUPABASE_SERVICE_ROLE_KEY}`,
    `Bearer ${fakeEnv.SUPABASE_ANON_KEY}`,
  ])
    equal(
      (await billing(portalInput, { authorization })).status,
      401,
      "Project keys are not user JWTs",
    );
  equal(
    (await billing({ ...checkoutInput, requestId: "short" })).status,
    400,
    "Stable request ID required",
  );
  equal(
    (await billing({ ...checkoutInput, price: "price_../escape" })).status,
    400,
    "Price identifier gate",
  );
  equal((await exchange("checkout", "{not-json")).status, 400, "Malformed JSON rejected");
  equal(upstreams.length, beforeGates, "Input gates cause no upstream calls");
  equal(
    (await billing(portalInput, { authorization: "Bearer forged-user" })).status,
    401,
    "Forged user rejected by Supabase",
  );
  equal(
    upstreams.slice(beforeGates).map((call) => call.path),
    ["/auth/v1/user"],
    "Forged JWT never reaches Stripe",
  );
  functionalChecks.push(
    "Origin, CORS, method, real-user JWT, request ID, price identifier and JSON gates before Stripe",
  );

  for (const price of [
    { ...validPrice(), active: false },
    { ...validPrice(), livemode: true },
    { ...validPrice(), metadata: { l8db_project: "foreign" } },
    { ...validPrice(), product: { id: "prod_fixture", active: false } },
  ]) {
    currentPrice = price;
    const before = upstreams.length;
    equal((await billing(checkoutInput)).status, 403, "Unavailable price rejected");
    equal(
      upstreams.slice(before).map((call) => call.path),
      ["/auth/v1/user", "/v1/prices/price_fixture"],
      "Unavailable price cannot create customers or sessions",
    );
  }
  currentPrice = validPrice();
  functionalChecks.push("active price and product, project scope and matching Stripe mode");

  const first = await billing(checkoutInput);
  equal(first.status, 200, "Checkout status");
  equal(
    JSON.parse(first.text),
    { url: "https://checkout.stripe.com/c/pay/cs_fixture" },
    "Checkout URL",
  );
  equal(first.headers.get("access-control-allow-origin"), ORIGIN, "Checkout CORS response");
  equal(first.headers.get("vary"), "Origin", "Checkout CORS varies by Origin");
  equal(lastCheckout.get("customer"), "cus_deno_fixture", "Session uses stored customer");
  equal(lastCheckout.get("client_reference_id"), ACTOR, "Session actor");
  equal(lastCheckout.get("mode"), "subscription", "Recurring price checkout mode");
  equal(
    lastCheckout.get("subscription_data[metadata][l8db_project]"),
    PROJECT,
    "Subscription project",
  );
  equal(
    lastCheckout.get("success_url"),
    `${ORIGIN}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    "Checkout redirect",
  );
  equal(customerCreations, 1, "Customer created once");
  const firstSession = upstreams.filter((call) => call.path === "/v1/checkout/sessions").at(-1);
  equal(
    firstSession?.idempotency,
    `l8db:${PROJECT}:${ACTOR}:checkout:price_fixture:${REQUEST}`,
    "Stable checkout idempotency",
  );
  equal((await billing(checkoutInput)).status, 200, "Checkout retry");
  equal(
    upstreams.filter((call) => call.path === "/v1/checkout/sessions").at(-1)?.idempotency,
    firstSession?.idempotency,
    "Retry preserves idempotency",
  );
  equal(customerCreations, 1, "Retry reuses customer");
  functionalChecks.push(
    "Checkout HTTP success, actor/project metadata, redirects, customer reuse and stable retry idempotency",
  );

  const portalAt = upstreams.length;
  const portal = await billing(portalInput);
  equal(portal.status, 200, "Portal status");
  equal(
    JSON.parse(portal.text),
    { url: "https://billing.stripe.com/p/session/fixture" },
    "Portal URL",
  );
  equal(lastPortal.get("customer"), customerId, "Portal uses authenticated actor customer");
  equal(lastPortal.get("return_url"), `${ORIGIN}/billing`, "Portal return URL");
  equal(
    upstreams.slice(portalAt).map((call) => call.path),
    ["/auth/v1/user", "/rest/v1/rpc/l8db_billing_customer", "/v1/billing_portal/sessions"],
    "Portal performs only three expected upstream reads/writes",
  );
  functionalChecks.push(
    "Portal HTTP success binds to the authenticated customer without price lookups",
  );

  oversizedPrice = true;
  const oversizedAt = upstreams.length;
  equal((await billing(checkoutInput)).status, 502, "Oversized Stripe response rejected");
  assert(oversizedResponseCancelled, "Actual upstream Response stream cancelled at limit");
  equal(
    upstreams.slice(oversizedAt).map((call) => call.path),
    ["/auth/v1/user", "/v1/prices/price_fixture"],
    "Oversized price response cannot create a session",
  );
  oversizedPrice = false;
  stripeFailure = true;
  const retryable = await billing(checkoutInput);
  equal(retryable.status, 502, "Stripe session failure retryable");
  assert(retryable.text.includes("same requestId"), "Retry guidance preserves request ID");
  assert(
    !retryable.text.includes(fakeEnv.L8DB_STRIPE_SECRET_KEY),
    "Stripe upstream details not leaked",
  );
  stripeFailure = false;
  functionalChecks.push(
    "bounded upstream response bytes, native cancellation and redacted retryable Stripe errors",
  );

  Deno.env.delete("L8DB_STRIPE_ACCOUNT");
  equal(
    (await hook(event("evt_config"))).status,
    503,
    "Webhook fails closed without configuration",
  );
  equal((await billing(portalInput)).status, 503, "Checkout fails closed without configuration");
  Deno.env.set("L8DB_STRIPE_ACCOUNT", ACCOUNT);
  assert(
    nativeServers.every((server) => server.inFlight === 0),
    "No abandoned native HTTP handlers",
  );
  functionalChecks.push("real Deno environment configuration failure and completed HTTP handlers");
}

async function performanceChecks() {
  const bodyBytes = 128 * 1024;
  const webhookMs: number[] = [];
  const checkoutMs: number[] = [];
  const nativeAt = nativeServers.reduce((sum, server) => sum + server.requests, 0);
  const upstreamAt = upstreams.length;
  const memoryAt = Deno.memoryUsage();
  let peakHeapGrowth = 0;
  let peakRssGrowth = 0;
  for (let index = 0; index < 31; index++) {
    const id = `evt_perf${index}`;
    const empty = event(id);
    const body = event(id, {}, {}, "x".repeat(bodyBytes - encoder.encode(empty).byteLength));
    equal(encoder.encode(body).byteLength, bodyBytes, "Realistic native request byte workload");
    const signed = await signature(body);
    let started = performance.now();
    equal((await hook(body, signed)).status, 200, "Performance webhook correctness");
    webhookMs.push(performance.now() - started);
    started = performance.now();
    equal(
      (
        await billing({
          action: "checkout",
          price: "price_fixture",
          requestId: `deno-performance-${index.toString().padStart(4, "0")}`,
        })
      ).status,
      200,
      "Performance checkout correctness",
    );
    checkoutMs.push(performance.now() - started);
    const memory = Deno.memoryUsage();
    peakHeapGrowth = Math.max(
      peakHeapGrowth,
      memory.heapUsed + memory.external - memoryAt.heapUsed - memoryAt.external,
    );
    peakRssGrowth = Math.max(peakRssGrowth, memory.rss - memoryAt.rss);
  }
  const percentile = (values: number[], fraction: number) =>
    [...values].sort((a, b) => a - b)[Math.ceil((values.length - 1) * fraction)];
  const webhook = { medianMs: percentile(webhookMs, 0.5), p95Ms: percentile(webhookMs, 0.95) };
  const checkout = { medianMs: percentile(checkoutMs, 0.5), p95Ms: percentile(checkoutMs, 0.95) };
  for (const measured of [webhook, checkout]) {
    assert(measured.medianMs < 100, `Native HTTP median exceeds 100ms: ${measured.medianMs}`);
    assert(measured.p95Ms < 250, `Native HTTP p95 exceeds 250ms: ${measured.p95Ms}`);
  }
  assert(
    peakHeapGrowth < 64 * 1024 * 1024,
    `Native heap/external growth exceeds 64MiB: ${peakHeapGrowth}`,
  );
  assert(peakRssGrowth < 64 * 1024 * 1024, `Native RSS growth exceeds 64MiB: ${peakRssGrowth}`);
  const sampled = upstreams.slice(upstreamAt);
  equal(
    sampled.filter((call) => call.path === "/rest/v1/rpc/l8db_billing_apply_event").length,
    31,
    "One storage request per valid webhook",
  );
  equal(
    sampled.length,
    31 + 31 * 4,
    "Warm checkout uses four upstream requests without duplicate customer creation",
  );
  equal(
    nativeServers.reduce((sum, server) => sum + server.requests, 0) - nativeAt,
    62,
    "Exactly 62 native HTTP workload requests",
  );
  equal(customerCreations, 1, "No duplicate customer creation during performance workload");
  assert(
    nativeServers.every((server) => server.maxInFlight <= 1 && server.inFlight === 0),
    "Sequential workload has one active handler and no abandoned work",
  );
  const idleBefore = {
    local: nativeServers.reduce((sum, server) => sum + server.requests, 0),
    upstream: upstreams.length,
  };
  await new Promise((resolve) => setTimeout(resolve, 250));
  equal(
    {
      local: nativeServers.reduce((sum, server) => sum + server.requests, 0),
      upstream: upstreams.length,
    },
    idleBefore,
    "No idle HTTP or upstream polling",
  );
  console.log(
    `PAYMENTS_DENO_RESULT ${JSON.stringify({
      runtime: Deno.version,
      platform: Deno.build,
      nativeServers: nativeServers.length,
      listenAdapter:
        "native Deno.serve with localhost and ephemeral ports; original product handlers and source unchanged",
      upstreamsMocked: ["Stripe", "Supabase"],
      functionalChecks,
      serverMetrics: nativeServers.map(({ kind, url, requests, maxInFlight, chunked }) => ({
        kind,
        url,
        requests,
        maxInFlight,
        chunked,
      })),
      upstreamRequests: upstreams.length,
      eventWrites,
      customerCreations,
      idleRequests: 0,
      performance: {
        iterations: 31,
        webhookBytes: bodyBytes,
        webhookRequests: 31,
        checkoutRequests: 31,
        webhook,
        checkout,
        upstreamRequests: sampled.length,
        peakHeapGrowthBytes: Math.max(0, peakHeapGrowth),
        peakRssGrowthBytes: Math.max(0, peakRssGrowth),
        maxConcurrency: 1,
      },
      limits: {
        medianMs: 100,
        p95Ms: 250,
        memoryGrowthBytes: 64 * 1024 * 1024,
        webhookBytes: 1048576,
        checkoutBytes: 4096,
        upstreamResponseBytes: 1048576,
      },
    })}`,
  );
}
