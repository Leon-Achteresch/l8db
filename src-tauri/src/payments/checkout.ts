const BODY_LIMIT = 4096;
const RESPONSE_LIMIT = 1_048_576;
const API_VERSION = "2025-03-31.basil";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Product {
  id?: unknown;
  active?: unknown;
}

interface Price {
  id?: unknown;
  active?: unknown;
  livemode?: unknown;
  type?: unknown;
  metadata?: { l8db_project?: unknown } | null;
  product?: Product | string | null;
}

interface BillingInput {
  action?: unknown;
  requestId?: unknown;
  price?: unknown;
}

class BillingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const env = (name: string) => Deno.env.get(name) ?? "";

export async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function json(response: Response): Promise<unknown> {
  const bytes = await readLimited(response.body, RESPONSE_LIMIT);
  if (!bytes) throw new BillingError(502, "Upstream response too large");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BillingError(502, "Upstream response invalid");
  }
}

async function stripe(path: string, fields?: URLSearchParams, idempotency?: string) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: fields ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env("L8DB_STRIPE_SECRET_KEY")}`,
      "Stripe-Version": API_VERSION,
      ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
    },
    body: fields,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await json(response);
  if (response.status === 404) throw new BillingError(404, "Stripe object not found");
  if (!response.ok) throw new BillingError(502, "Stripe request failed");
  return data as Record<string, unknown>;
}

async function customer(account: string, actor: string, created: string | null = null) {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/l8db_billing_customer`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ account, actor, stripe_customer: created }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await json(response);
  if (!response.ok) throw new BillingError(502, "Customer storage unavailable");
  return typeof data === "string" ? data : null;
}

async function user(authorization: string) {
  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: env("SUPABASE_ANON_KEY") || env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: authorization,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await json(response)) as { id?: unknown; email?: unknown } | null;
  if (!response.ok || typeof data?.id !== "string" || !UUID.test(data.id)) {
    throw new BillingError(401, "Invalid user session");
  }
  return { id: data.id, email: typeof data.email === "string" ? data.email : null };
}

async function availablePrice(id: string, project: string, live: boolean) {
  const price = (await stripe(`prices/${id}?expand[]=product`)) as Price;
  const product = typeof price.product === "object" ? price.product : null;
  if (
    price.active !== true ||
    price.livemode !== live ||
    price.metadata?.l8db_project !== project ||
    product?.active !== true
  ) {
    throw new BillingError(403, "Price not available in this project");
  }
  return price;
}

export async function handle(request: Request): Promise<Response> {
  const origin = env("L8DB_BILLING_ORIGIN");
  const project = env("L8DB_BILLING_PROJECT");
  const account = env("L8DB_STRIPE_ACCOUNT");
  const live = env("L8DB_STRIPE_MODE") === "live";
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  const respond = (status: number, data: unknown) => Response.json(data, { status, headers });
  const caller = request.headers.get("origin");
  if (caller && caller !== origin) return respond(403, { error: "Origin not allowed" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed" });
  if (!origin || !project || !account || !service || !env("L8DB_STRIPE_SECRET_KEY") || !env("SUPABASE_URL")) {
    return respond(503, { error: "Billing is not configured" });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token === service || token === env("SUPABASE_ANON_KEY")) {
    return respond(401, { error: "User authentication required" });
  }
  if (Number(request.headers.get("content-length") ?? 0) > BODY_LIMIT) {
    return respond(413, { error: "Payload too large" });
  }
  const body = await readLimited(request.body, BODY_LIMIT);
  if (!body) return respond(413, { error: "Payload too large" });
  let input: BillingInput | null;
  try {
    input = JSON.parse(new TextDecoder().decode(body)) as BillingInput | null;
  } catch {
    return respond(400, { error: "Invalid JSON" });
  }
  const action = input?.action;
  const requestId = input?.requestId;
  const priceId = input?.price;
  if (action !== "checkout" && action !== "portal") return respond(400, { error: "Invalid action" });
  if (typeof requestId !== "string" || !/^[A-Za-z0-9-]{16,80}$/.test(requestId)) {
    return respond(400, { error: "Stable requestId required" });
  }
  if (action === "checkout" && (typeof priceId !== "string" || !/^price_[A-Za-z0-9]{1,120}$/.test(priceId))) {
    return respond(400, { error: "Invalid price" });
  }
  try {
    const actor = await user(`Bearer ${token}`);
    const price = action === "checkout" ? await availablePrice(String(priceId), project, live) : null;
    let customerId = await customer(account, actor.id);
    if (!customerId) {
      const fields = new URLSearchParams({
        "metadata[supabase_user_id]": actor.id,
        "metadata[l8db_project]": project,
      });
      if (actor.email) fields.set("email", actor.email);
      const created = await stripe("customers", fields, `l8db:${project}:customer:${account}:${actor.id}`);
      if (typeof created.id !== "string") throw new BillingError(502, "Customer unavailable");
      customerId = await customer(account, actor.id, created.id);
    }
    if (!customerId) throw new BillingError(502, "Customer unavailable");
    if (action === "portal") {
      const session = await stripe(
        "billing_portal/sessions",
        new URLSearchParams({ customer: customerId, return_url: `${origin}/billing` }),
        `l8db:${project}:${actor.id}:portal:${requestId}`,
      );
      return respond(200, { url: session.url });
    }
    const mode = price?.type === "recurring" ? "subscription" : "payment";
    const fields = new URLSearchParams({
      customer: customerId,
      mode,
      client_reference_id: actor.id,
      "line_items[0][price]": String(priceId),
      "line_items[0][quantity]": "1",
      success_url: `${origin}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing?checkout=cancelled`,
      "metadata[l8db_project]": project,
      "metadata[supabase_user_id]": actor.id,
    });
    if (mode === "subscription") {
      fields.set("subscription_data[metadata][l8db_project]", project);
      fields.set("subscription_data[metadata][supabase_user_id]", actor.id);
    }
    const session = await stripe(
      "checkout/sessions",
      fields,
      `l8db:${project}:${actor.id}:checkout:${priceId}:${requestId}`,
    );
    return respond(200, { url: session.url });
  } catch (error) {
    if (error instanceof BillingError && error.status !== 502) {
      return respond(error.status, { error: error.message });
    }
    return respond(502, { error: "Billing request failed. Retry with the same requestId." });
  }
}

Deno.serve(handle);
