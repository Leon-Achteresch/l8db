const BODY_LIMIT = 1_048_576;
const TOLERANCE_SECONDS = 300;
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "product.created",
  "product.updated",
  "product.deleted",
  "price.created",
  "price.updated",
  "price.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);
const encoder = new TextEncoder();

interface Metadata {
  l8db_project?: unknown;
}

interface Details {
  metadata?: Metadata | null;
}

interface StripeObject {
  id?: unknown;
  metadata?: Metadata | null;
  parent?: { subscription_details?: Details | null } | null;
  subscription_details?: Details | null;
}

interface StripeEvent {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  livemode?: unknown;
  api_version?: unknown;
  data?: { object?: StripeObject | null } | null;
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

export async function verifySignature(
  payload: Uint8Array,
  header: string,
  secret: string,
  now = Date.now() / 1000,
): Promise<boolean> {
  const parts = header.split(",").map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
  });
  const stamp = parts.find(([name]) => name === "t")?.[1] ?? "";
  if (!secret || !/^\d{1,12}$/.test(stamp)) return false;
  if (Math.abs(now - Number(stamp)) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const prefix = encoder.encode(`${stamp}.`);
  const signed = new Uint8Array(prefix.byteLength + payload.byteLength);
  signed.set(prefix);
  signed.set(payload, prefix.byteLength);
  for (const [name, value] of parts) {
    if (name !== "v1" || !/^[a-f0-9]{64}$/i.test(value)) continue;
    const signature = new Uint8Array(32);
    for (let index = 0; index < 32; index++) {
      signature[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    if (await crypto.subtle.verify("HMAC", key, signature, signed)) return true;
  }
  return false;
}

export function projectOf(object: StripeObject | null | undefined): unknown {
  return (
    object?.metadata?.l8db_project ??
    object?.parent?.subscription_details?.metadata?.l8db_project ??
    object?.subscription_details?.metadata?.l8db_project
  );
}

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function handle(request: Request): Promise<Response> {
  if (request.method !== "POST") return text(405, "Method not allowed");
  const secret = env("L8DB_STRIPE_WEBHOOK_SECRET");
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const base = env("SUPABASE_URL");
  const project = env("L8DB_BILLING_PROJECT");
  const account = env("L8DB_STRIPE_ACCOUNT");
  const live = env("L8DB_STRIPE_MODE") === "live";
  if (!secret || !service || !base || !project || !account) return text(503, "Billing is not configured");
  if (Number(request.headers.get("content-length") ?? 0) > BODY_LIMIT) return text(413, "Payload too large");
  const payload = await readLimited(request.body, BODY_LIMIT);
  if (!payload) return text(413, "Payload too large");
  const header = request.headers.get("stripe-signature") ?? "";
  if (!(await verifySignature(payload, header, secret))) return text(400, "Invalid signature");
  let event: StripeEvent | null;
  try {
    event = JSON.parse(new TextDecoder().decode(payload)) as StripeEvent | null;
  } catch {
    return text(400, "Invalid event");
  }
  const target = event?.data?.object;
  if (
    !event ||
    typeof event.id !== "string" ||
    !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
    typeof event.type !== "string" ||
    typeof event.created !== "number" ||
    typeof target?.id !== "string"
  ) {
    return text(400, "Invalid event");
  }
  if (event.livemode !== live) return text(400, "Wrong Stripe mode");
  if (!HANDLED.has(event.type) || projectOf(target) !== project) return text(200, "ignored");
  try {
    const response = await fetch(`${base}/rest/v1/rpc/l8db_billing_apply_event`, {
      method: "POST",
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event, account }),
      signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel();
    return response.ok ? text(200, "ok") : text(503, "Storage unavailable");
  } catch {
    return text(503, "Event processing failed");
  }
}

Deno.serve(handle);
