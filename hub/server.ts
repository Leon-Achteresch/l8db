import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface HubConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  sessionSecret: string;
  connectionsFile: string;
  scopes?: string;
  tokenTtlSeconds?: number;
  name?: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

interface HubUser {
  sub: string;
  email: string;
  name: string;
  groups: string[];
}

interface PendingLogin {
  port: number;
  appState: string;
  appChallenge: string;
  nonce: string;
  verifier: string;
  expires: number;
}

interface PendingCode {
  user: HubUser;
  appChallenge: string;
  expires: number;
}

export interface TeamConnection {
  id: string;
  name: string;
  kind: string;
  connectionString: string;
  groups?: string[];
  [field: string]: unknown;
}

const PENDING_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const PENDING_LIMIT = 10_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const APP_STATE = /^[A-Za-z0-9_-]{16,128}$/;
const PUBLIC_FIELDS = [
  "id",
  "name",
  "kind",
  "connectionString",
  "sslMode",
  "ssh",
  "proxy",
  "tags",
  "color",
  "readOnly",
  "environment",
  "schemas",
];

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const random = () => base64url(randomBytes(32));
const s256 = (value: string) => base64url(createHash("sha256").update(value).digest());

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function page(message: string, status = 400): Response {
  return new Response(`l8db Team-Hub: ${message}`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function urlPassword(value: string): boolean {
  try {
    return new URL(value).password !== "";
  } catch {
    return /(^|;)\s*(password|pwd)\s*=/i.test(value);
  }
}

export function parseConnections(raw: string): TeamConnection[] {
  const parsed = JSON.parse(raw) as { connections?: unknown };
  if (!Array.isArray(parsed.connections)) throw new Error("connections fehlt");
  const ids = new Set<string>();
  return parsed.connections.map((entry, index) => {
    const connection = entry as TeamConnection;
    const label = `connections[${index}]`;
    if (typeof connection?.id !== "string" || !SAFE_ID.test(connection.id))
      throw new Error(`${label}.id muss aus A-Z, a-z, 0-9, _ und - bestehen`);
    if (ids.has(connection.id)) throw new Error(`${label}.id ist doppelt`);
    ids.add(connection.id);
    for (const field of ["name", "kind", "connectionString"] as const)
      if (typeof connection[field] !== "string" || !connection[field])
        throw new Error(`${label}.${field} fehlt`);
    if (urlPassword(connection.connectionString))
      throw new Error(`${label}.connectionString darf kein Passwort enthalten`);
    if (
      connection.groups !== undefined &&
      (!Array.isArray(connection.groups) ||
        connection.groups.some((group) => typeof group !== "string"))
    )
      throw new Error(`${label}.groups muss eine Liste von Texten sein`);
    return connection;
  });
}

export function visibleConnections(connections: TeamConnection[], groups: string[]) {
  const member = new Set(groups);
  return connections
    .filter(
      (connection) =>
        !connection.groups?.length || connection.groups.some((group) => member.has(group)),
    )
    .map((connection) =>
      Object.fromEntries(
        PUBLIC_FIELDS.filter((field) => field in connection).map((field) => [
          field,
          connection[field],
        ]),
      ),
    );
}

function claimsOf(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("ID-Token ungültig");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function createHub(config: HubConfig, fetcher: typeof fetch = fetch) {
  const publicUrl = config.publicUrl.replace(/\/+$/, "");
  const prefix = new URL(publicUrl).pathname.replace(/\/+$/, "");
  const ttl = config.tokenTtlSeconds ?? 7 * 24 * 60 * 60;
  const logins = new Map<string, PendingLogin>();
  const codes = new Map<string, PendingCode>();
  let discovery: Promise<Discovery> | null = null;
  let cache: { modified: number; connections: TeamConnection[] } | null = null;

  const discover = () => {
    discovery ??= fetcher(`${config.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`OIDC-Discovery fehlgeschlagen (${response.status})`);
        const document = (await response.json()) as Discovery;
        if (!document.authorization_endpoint || !document.token_endpoint || !document.issuer)
          throw new Error("OIDC-Discovery unvollständig");
        return document;
      })
      .catch((error) => {
        discovery = null;
        throw error;
      });
    return discovery;
  };

  const prune = (map: Map<string, { expires: number }>) => {
    const now = Date.now();
    for (const [key, value] of map) if (value.expires <= now) map.delete(key);
    for (const key of map.keys()) {
      if (map.size < PENDING_LIMIT) break;
      map.delete(key);
    }
  };

  const sign = (payload: string) =>
    createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

  const issueToken = (user: HubUser) => {
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const payload = base64url(JSON.stringify({ ...user, exp: expiresAt }));
    return { token: `${payload}.${sign(payload)}`, expiresAt };
  };

  const verifyToken = (header: string | null): HubUser | null => {
    const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const [payload, signature, extra] = token?.split(".") ?? [];
    if (!payload || !signature || extra !== undefined || !safeEqual(signature, sign(payload)))
      return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
      return {
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        groups: strings(claims.groups),
      };
    } catch {
      return null;
    }
  };

  const loadConnections = async () => {
    const file = Bun.file(config.connectionsFile);
    const modified = file.lastModified;
    if (cache?.modified !== modified)
      cache = { modified, connections: parseConnections(await file.text()) };
    return cache.connections;
  };

  const login = async (url: URL) => {
    const port = Number(url.searchParams.get("port"));
    const appState = url.searchParams.get("state") ?? "";
    const appChallenge = url.searchParams.get("code_challenge") ?? "";
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return page("port ungültig");
    if (!APP_STATE.test(appState)) return page("state ungültig");
    if (!CHALLENGE.test(appChallenge)) return page("code_challenge ungültig");
    prune(logins);
    const oidc = await discover();
    const state = random();
    const pending: PendingLogin = {
      port,
      appState,
      appChallenge,
      nonce: random(),
      verifier: random(),
      expires: Date.now() + PENDING_TTL_MS,
    };
    logins.set(state, pending);
    const target = new URL(oidc.authorization_endpoint);
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: `${publicUrl}/auth/callback`,
      scope: config.scopes ?? "openid profile email",
      state,
      nonce: pending.nonce,
      code_challenge: s256(pending.verifier),
      code_challenge_method: "S256",
    }).toString();
    return Response.redirect(target.toString(), 302);
  };

  const callback = async (url: URL) => {
    const state = url.searchParams.get("state") ?? "";
    const pending = logins.get(state);
    logins.delete(state);
    if (!pending || pending.expires <= Date.now())
      return page("Anmeldung abgelaufen. Bitte in l8db erneut starten.");
    const providerError = url.searchParams.get("error");
    if (providerError)
      return page(
        `Anmeldung abgelehnt: ${url.searchParams.get("error_description") ?? providerError}`,
        403,
      );
    const code = url.searchParams.get("code");
    if (!code) return page("code fehlt");
    const oidc = await discover();
    const response = await fetcher(oidc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${publicUrl}/auth/callback`,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: pending.verifier,
      }),
    });
    if (!response.ok) return page(`Token-Austausch fehlgeschlagen (${response.status})`, 502);
    const tokens = (await response.json()) as { id_token?: string };
    if (!tokens.id_token) return page("Identity Provider lieferte kein ID-Token", 502);
    const claims = claimsOf(tokens.id_token);
    const audience = strings(Array.isArray(claims.aud) ? claims.aud : [claims.aud]);
    if (claims.iss !== oidc.issuer) return page("ID-Token: falscher Aussteller", 401);
    if (!audience.includes(config.clientId)) return page("ID-Token: falsche Zielgruppe", 401);
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now())
      return page("ID-Token abgelaufen", 401);
    if (claims.nonce !== pending.nonce) return page("ID-Token: nonce passt nicht", 401);
    if (typeof claims.sub !== "string") return page("ID-Token: sub fehlt", 401);
    if ((claims._claim_names as Record<string, unknown> | undefined)?.groups)
      return page(
        "Zu viele Gruppen für das Token. Im Identity Provider nur der Anwendung zugewiesene Gruppen ausgeben.",
        403,
      );
    prune(codes);
    const email = [claims.email, claims.preferred_username, claims.upn].find(
      (value) => typeof value === "string",
    ) as string | undefined;
    const user: HubUser = {
      sub: claims.sub,
      email: email ?? claims.sub,
      name: typeof claims.name === "string" ? claims.name : (email ?? claims.sub),
      groups: [...strings(claims.groups), ...strings(claims.roles)],
    };
    const appCode = random();
    codes.set(appCode, {
      user,
      appChallenge: pending.appChallenge,
      expires: Date.now() + CODE_TTL_MS,
    });
    const target = new URL(`http://127.0.0.1:${pending.port}/callback`);
    target.search = new URLSearchParams({ code: appCode, state: pending.appState }).toString();
    return Response.redirect(target.toString(), 302);
  };

  const token = async (request: Request) => {
    const body = (await request.json().catch(() => null)) as {
      code?: unknown;
      code_verifier?: unknown;
    } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    const verifier = typeof body?.code_verifier === "string" ? body.code_verifier : "";
    const pending = codes.get(code);
    codes.delete(code);
    if (
      !pending ||
      pending.expires <= Date.now() ||
      !safeEqual(s256(verifier), pending.appChallenge)
    )
      return fail("Anmeldecode ungültig oder abgelaufen", 401);
    return json({
      ...issueToken(pending.user),
      user: { email: pending.user.email, name: pending.user.name },
    });
  };

  const connections = async (request: Request) => {
    const user = verifyToken(request.headers.get("authorization"));
    if (!user) return fail("Nicht angemeldet", 401);
    return json({
      name: config.name ?? "Team",
      user: { email: user.email, name: user.name },
      connections: visibleConnections(await loadConnections(), user.groups),
    });
  };

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname.startsWith(`${prefix}/`)
        ? url.pathname.slice(prefix.length)
        : url.pathname;
      const route = `${request.method} ${path}`;
      try {
        if (route === "GET /health") return json({ ok: true });
        if (route === "GET /auth/login") return await login(url);
        if (route === "GET /auth/callback") return await callback(url);
        if (route === "POST /auth/token") return await token(request);
        if (route === "GET /api/connections") return await connections(request);
        return fail("Nicht gefunden", 404);
      } catch (error) {
        console.error(error);
        return fail("Interner Fehler", 500);
      }
    },
    loadConnections,
  };
}

export function configFromEnv(env: Record<string, string | undefined>): HubConfig {
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`${key} fehlt`);
    return value;
  };
  const sessionSecret = required("L8DB_HUB_SESSION_SECRET");
  if (sessionSecret.length < 32)
    throw new Error("L8DB_HUB_SESSION_SECRET muss mindestens 32 Zeichen haben");
  return {
    issuer: required("L8DB_HUB_ISSUER"),
    clientId: required("L8DB_HUB_CLIENT_ID"),
    clientSecret: required("L8DB_HUB_CLIENT_SECRET"),
    publicUrl: required("L8DB_HUB_PUBLIC_URL"),
    sessionSecret,
    connectionsFile: env.L8DB_HUB_CONNECTIONS_FILE?.trim() || "connections.json",
    scopes: env.L8DB_HUB_SCOPES?.trim() || undefined,
    tokenTtlSeconds: env.L8DB_HUB_TOKEN_TTL_SECONDS
      ? Number(env.L8DB_HUB_TOKEN_TTL_SECONDS)
      : undefined,
    name: env.L8DB_HUB_NAME?.trim() || undefined,
  };
}

if (import.meta.main) {
  const config = configFromEnv(process.env);
  const hub = createHub(config);
  await hub.loadConnections();
  const server = Bun.serve({ port: Number(process.env.PORT ?? 8080), fetch: hub.fetch });
  console.log(`l8db Team-Hub läuft auf ${server.url} (öffentlich: ${config.publicUrl})`);
}
