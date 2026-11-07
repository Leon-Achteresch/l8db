import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const PROJECT = "abcdefghijklmnopqrst";
const ACCOUNT = "acct_1";
const USER = "3f2a7c1e-9b4d-4e8f-a1c2-0d9e8f7a6b5c";
const SECRET = "whsec_test_secret";
const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";

const env: Record<string, string> = {};
const servers: unknown[] = [];
const baseEnv = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_ANON_KEY: "anon-key",
  L8DB_STRIPE_SECRET_KEY: "sk_test_function",
  L8DB_STRIPE_WEBHOOK_SECRET: SECRET,
  L8DB_STRIPE_ACCOUNT: ACCOUNT,
  L8DB_STRIPE_MODE: "test",
  L8DB_BILLING_PROJECT: PROJECT,
  L8DB_BILLING_ORIGIN: "https://app.example.com",
};

Object.assign(globalThis, {
  Deno: {
    env: { get: (name: string) => env[name] },
    serve: (handler: unknown) => servers.push(handler),
  },
});

type Call = { url: URL; method: string; headers: Record<string, string>; body: string };
type Route = (call: Call) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
const fetched: Call[] = [];
let route: Route = () => new Response("unexpected", { status: 599 });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const call: Call = {
    url: new URL(String(input)),
    method: init?.method ?? "GET",
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? String(init.body) : "",
  };
  fetched.push(call);
  return route(call);
}) as typeof fetch;

const webhook = await import("../src-tauri/src/payments/webhook.ts");
const checkout = await import("../src-tauri/src/payments/checkout.ts");

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, baseEnv);
  fetched.length = 0;
  route = () => new Response("unexpected", { status: 599 });
});

const json = (data: unknown, status = 200) => Response.json(data, { status });

function signed(body: string, at = Math.floor(Date.now() / 1000), secret = SECRET) {
  const signature = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return `t=${at},v1=${"0".repeat(64)},v1=${signature}`;
}

function event(overrides: Record<string, unknown> = {}, object: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_123",
    type: "customer.subscription.updated",
    created: 1_760_000_000,
    livemode: false,
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        metadata: { l8db_project: PROJECT },
        ...object,
      },
    },
    ...overrides,
  });
}

function hook(body: BodyInit, signature: string, headers: Record<string, string> = {}) {
  return webhook.handle(
    new Request(`${SUPABASE}/functions/v1/l8db-billing-webhook`, {
      method: "POST",
      body,
      headers: { "stripe-signature": signature, ...headers },
    }),
  );
}

function stream(chunk: number, count: number) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ >= count) controller.close();
      else controller.enqueue(new Uint8Array(chunk));
    },
  });
}

describe("Webhook-Funktion", () => {
  test("beide Funktionen registrieren genau einen Handler", () => {
    expect(servers).toHaveLength(2);
  });

  test("prüft die HMAC-Signatur über den Rohtext und speichert Projektereignisse", async () => {
    let stored: Record<string, unknown> | null = null;
    route = (call) => {
      stored = JSON.parse(call.body);
      expect(call.url.pathname).toBe("/rest/v1/rpc/l8db_billing_apply_event");
      expect(call.headers.Authorization).toBe("Bearer service-role-key");
      return json(true);
    };
    const body = event();
    const response = await hook(body, signed(body));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(stored).toMatchObject({ account: ACCOUNT, event: { id: "evt_123" } });
  });

  test("Abo-Rechnungen werden über parent.subscription_details zugeordnet", async () => {
    route = () => json(true);
    const body = event(
      { type: "invoice.paid" },
      {
        id: "in_1",
        object: "invoice",
        metadata: {},
        parent: { subscription_details: { metadata: { l8db_project: PROJECT } } },
      },
    );
    expect((await hook(body, signed(body))).status).toBe(200);
    expect(fetched).toHaveLength(1);
  });

  test("lehnt falsche, veränderte und veraltete Signaturen ab", async () => {
    const body = event();
    expect((await hook(body, signed(body, undefined, "whsec_other"))).status).toBe(400);
    expect((await hook(`${body} `, signed(body))).status).toBe(400);
    expect((await hook(body, signed(body, Math.floor(Date.now() / 1000) - 301))).status).toBe(400);
    expect((await hook(body, "v1=abc")).status).toBe(400);
    expect(fetched).toHaveLength(0);
  });

  test("ignoriert fremde Projekte und unbekannte Ereignisse, lehnt falschen Modus ab", async () => {
    const foreign = event({}, { metadata: { l8db_project: "otherproject" } });
    const untagged = event({}, { metadata: {} });
    const unknown = event({ type: "charge.refunded" });
    const live = event({ livemode: true });
    expect(await (await hook(foreign, signed(foreign))).text()).toBe("ignored");
    expect(await (await hook(untagged, signed(untagged))).text()).toBe("ignored");
    expect(await (await hook(unknown, signed(unknown))).text()).toBe("ignored");
    expect((await hook(live, signed(live))).status).toBe(400);
    expect(fetched).toHaveLength(0);
  });

  test("begrenzt den Rohtext auch ohne Content-Length", async () => {
    const response = await hook(stream(256 * 1024, 5), signed("x"));
    expect(response.status).toBe(413);
    expect(fetched).toHaveLength(0);
  });

  test("meldet Speicherfehler mit 503, damit Stripe erneut zustellt", async () => {
    route = () => json({ message: "down" }, 500);
    const body = event();
    expect((await hook(body, signed(body))).status).toBe(503);
  });

  test("fehlende Konfiguration ergibt 503", async () => {
    delete env.L8DB_STRIPE_ACCOUNT;
    const body = event();
    expect((await hook(body, signed(body))).status).toBe(503);
  });
});

type Store = Map<string, string>;

function billing(customers: Store, price: Record<string, unknown>) {
  return (call: Call): Response => {
    const path = call.url.pathname;
    if (call.url.origin === SUPABASE && path === "/auth/v1/user") {
      expect(call.headers.apikey).toBe("anon-key");
      return call.headers.Authorization === "Bearer user-jwt"
        ? json({ id: USER, email: "kunde@example.com" })
        : json({ msg: "invalid" }, 401);
    }
    if (call.url.origin === SUPABASE && path === "/rest/v1/rpc/l8db_billing_customer") {
      const input = JSON.parse(call.body) as {
        account: string;
        actor: string;
        stripe_customer: string | null;
      };
      const key = `${input.account}:${input.actor}`;
      if (input.stripe_customer && !customers.has(key)) customers.set(key, input.stripe_customer);
      return json(customers.get(key) ?? null);
    }
    if (path.startsWith("/v1/prices/")) {
      expect(call.url.searchParams.get("expand[]")).toBe("product");
      return json(price);
    }
    if (path === "/v1/customers") return json({ id: "cus_new" });
    if (path === "/v1/checkout/sessions")
      return json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    if (path === "/v1/billing_portal/sessions")
      return json({ url: "https://billing.stripe.com/p/session/1" });
    return json({ error: "unexpected" }, 500);
  };
}

const PRICE = {
  id: "price_ok",
  active: true,
  livemode: false,
  type: "recurring",
  metadata: { l8db_project: PROJECT },
  product: { id: "prod_1", active: true },
};

function call(body: unknown, headers: Record<string, string> = {}) {
  return checkout.handle(
    new Request(`${SUPABASE}/functions/v1/l8db-billing`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { authorization: "Bearer user-jwt", origin: "https://app.example.com", ...headers },
    }),
  );
}

const REQUEST = "req-1234567890abcdef";

describe("Checkout-Funktion", () => {
  test("legt Kunden serverseitig an und erzeugt Checkout mit stabilen Idempotenzschlüsseln", async () => {
    const customers: Store = new Map();
    route = billing(customers, PRICE);
    const response = await call({ action: "checkout", price: "price_ok", requestId: REQUEST });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    const created = fetched.find((entry) => entry.url.pathname === "/v1/customers");
    expect(created?.headers["Idempotency-Key"]).toBe(`l8db:${PROJECT}:customer:${ACCOUNT}:${USER}`);
    expect(new URLSearchParams(created?.body).get("metadata[supabase_user_id]")).toBe(USER);
    const session = fetched.find((entry) => entry.url.pathname === "/v1/checkout/sessions");
    expect(session?.headers["Idempotency-Key"]).toBe(
      `l8db:${PROJECT}:${USER}:checkout:price_ok:${REQUEST}`,
    );
    expect(session?.headers["Stripe-Version"]).toBe("2025-03-31.basil");
    const fields = new URLSearchParams(session?.body);
    expect(fields.get("customer")).toBe("cus_new");
    expect(fields.get("mode")).toBe("subscription");
    expect(fields.get("client_reference_id")).toBe(USER);
    expect(fields.get("subscription_data[metadata][l8db_project]")).toBe(PROJECT);
    expect(fields.get("success_url")).toBe(
      "https://app.example.com/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}",
    );
    fetched.length = 0;
    await call({ action: "checkout", price: "price_ok", requestId: REQUEST });
    expect(fetched.some((entry) => entry.url.pathname === "/v1/customers")).toBe(false);
    const retry = fetched.find((entry) => entry.url.pathname === "/v1/checkout/sessions");
    expect(retry?.headers["Idempotency-Key"]).toBe(session?.headers["Idempotency-Key"]);
  });

  test("Portal nutzt den gespeicherten Kunden des angemeldeten Nutzers", async () => {
    const customers: Store = new Map([[`${ACCOUNT}:${USER}`, "cus_known"]]);
    route = billing(customers, PRICE);
    const response = await call({ action: "portal", requestId: REQUEST });
    expect(await response.json()).toEqual({ url: "https://billing.stripe.com/p/session/1" });
    const portal = fetched.find((entry) => entry.url.pathname === "/v1/billing_portal/sessions");
    expect(new URLSearchParams(portal?.body).get("customer")).toBe("cus_known");
    expect(new URLSearchParams(portal?.body).get("return_url")).toBe(
      "https://app.example.com/billing",
    );
    expect(fetched.some((entry) => entry.url.pathname.startsWith("/v1/prices"))).toBe(false);
  });

  test("nur aktive Preise dieses Projekts mit aktivem Produkt im richtigen Modus", async () => {
    for (const price of [
      { ...PRICE, metadata: { l8db_project: "other" } },
      { ...PRICE, active: false },
      { ...PRICE, product: { id: "prod_1", active: false } },
      { ...PRICE, livemode: true },
    ]) {
      fetched.length = 0;
      route = billing(new Map(), price);
      const response = await call({ action: "checkout", price: "price_ok", requestId: REQUEST });
      expect(response.status).toBe(403);
      expect(fetched.some((entry) => entry.url.pathname === "/v1/checkout/sessions")).toBe(false);
      expect(fetched.some((entry) => entry.url.pathname === "/v1/customers")).toBe(false);
    }
  });

  test("verlangt eine gültige Nutzersitzung, keine Projektschlüssel", async () => {
    route = billing(new Map(), PRICE);
    expect(
      (await call({ action: "portal", requestId: REQUEST }, { authorization: "" })).status,
    ).toBe(401);
    expect(
      (
        await call(
          { action: "portal", requestId: REQUEST },
          { authorization: "Bearer service-role-key" },
        )
      ).status,
    ).toBe(401);
    expect(
      (await call({ action: "portal", requestId: REQUEST }, { authorization: "Bearer anon-key" }))
        .status,
    ).toBe(401);
    expect(fetched).toHaveLength(0);
    expect(
      (await call({ action: "portal", requestId: REQUEST }, { authorization: "Bearer forged" }))
        .status,
    ).toBe(401);
    expect(fetched.map((entry) => entry.url.pathname)).toEqual(["/auth/v1/user"]);
  });

  test("CORS, Methode und Eingaben werden streng geprüft", async () => {
    route = billing(new Map(), PRICE);
    const preflight = await checkout.handle(
      new Request(`${SUPABASE}/functions/v1/l8db-billing`, {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com" },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(
      (await call({ action: "portal", requestId: REQUEST }, { origin: "https://evil.test" }))
        .status,
    ).toBe(403);
    expect((await call({ action: "refund", requestId: REQUEST })).status).toBe(400);
    expect((await call({ action: "checkout", requestId: "short", price: "price_ok" })).status).toBe(
      400,
    );
    expect(
      (await call({ action: "checkout", requestId: REQUEST, price: "price_../x" })).status,
    ).toBe(400);
    expect((await call("{not json")).status).toBe(400);
    expect(fetched).toHaveLength(0);
  });

  test("begrenzt Anfrage und Antworten auf tatsächliche Bytes", async () => {
    route = billing(new Map(), PRICE);
    const streamed = await checkout.handle(
      new Request(`${SUPABASE}/functions/v1/l8db-billing`, {
        method: "POST",
        body: stream(1024, 8),
        headers: { authorization: "Bearer user-jwt" },
      }),
    );
    expect(streamed.status).toBe(413);
    expect((await call({ pad: "x".repeat(5000) })).status).toBe(413);
    expect(fetched).toHaveLength(0);
    route = (entry) =>
      entry.url.pathname === "/auth/v1/user"
        ? json({ id: USER })
        : new Response("x".repeat(1_100_000), { status: 200 });
    const huge = await call({ action: "checkout", price: "price_ok", requestId: REQUEST });
    expect(huge.status).toBe(502);
  });

  test("Stripe-Fehler werden ohne Details als wiederholbar gemeldet", async () => {
    const customers: Store = new Map([[`${ACCOUNT}:${USER}`, "cus_known"]]);
    const base = billing(customers, PRICE);
    route = (entry) =>
      entry.url.pathname === "/v1/checkout/sessions"
        ? json({ error: { message: "sk_test_function leaked?" } }, 500)
        : base(entry);
    const response = await call({ action: "checkout", price: "price_ok", requestId: REQUEST });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("same requestId");
    expect(text).not.toContain("sk_test");
  });
});

test("Edge-Function-Quelltexte bestehen eine strikte TypeScript-Prüfung", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "node_modules/typescript/bin/tsc",
      "-p",
      "tests/payments-functions.tsconfig.json",
    ],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  expect(`${result.stdout.toString()}${result.stderr.toString()}`).toBe("");
  expect(result.exitCode).toBe(0);
}, 60_000);
