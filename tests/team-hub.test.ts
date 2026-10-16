import { afterAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHub, parseConnections, visibleConnections } from "../hub/server";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const ISSUER = "https://idp.test/tenant/v2.0";
const CLIENT_ID = "hub-client";
const PUBLIC_URL = "https://hub.firma.test";
const dir = mkdtempSync(join(tmpdir(), "l8db-hub-"));
const connectionsFile = join(dir, "connections.json");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const s256 = (value: string) => createHash("sha256").update(value).digest("base64url");
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

writeFileSync(
  connectionsFile,
  JSON.stringify({
    connections: [
      {
        id: "erp",
        name: "ERP",
        kind: "postgres",
        connectionString: "postgres://erp.intern:5432/erp",
      },
      {
        id: "lohn",
        name: "Lohn",
        kind: "mssql",
        connectionString: "mssql://lohn.intern:1433/lohn",
        groups: ["grp-hr"],
        commandTunnel: { command: "calc.exe" },
      },
    ],
  }),
);

interface IdpOptions {
  claims?: Record<string, unknown>;
}

function fakeIdp(options: IdpOptions = {}) {
  const issued = new Map<string, { nonce: string; challenge: string }>();
  let tokenRequests = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/openid-configuration`)
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: "https://idp.test/authorize",
        token_endpoint: "https://idp.test/token",
      });
    if (url === "https://idp.test/token") {
      tokenRequests++;
      const body = new URLSearchParams(String(init?.body));
      const grant = issued.get(body.get("code") ?? "");
      if (
        !grant ||
        body.get("client_secret") !== "secret" ||
        s256(body.get("code_verifier") ?? "") !== grant.challenge
      )
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      const claims = {
        iss: ISSUER,
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 300,
        sub: "user-1",
        preferred_username: "max@firma.test",
        name: "Max Muster",
        nonce: grant.nonce,
        groups: ["grp-hr"],
        ...options.claims,
      };
      return Response.json({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.sig` });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  const authorize = (location: string) => {
    const url = new URL(location);
    const code = randomBytes(8).toString("hex");
    issued.set(code, {
      nonce: url.searchParams.get("nonce") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
    });
    return { code, state: url.searchParams.get("state") ?? "" };
  };
  return { fetcher, authorize, tokenRequests: () => tokenRequests };
}

function hubWith(idp = fakeIdp(), tokenTtlSeconds?: number) {
  return createHub(
    {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "secret",
      publicUrl: PUBLIC_URL,
      sessionSecret: "x".repeat(40),
      connectionsFile,
      tokenTtlSeconds,
      name: "Firma",
    },
    idp.fetcher,
  );
}

async function login(hub: ReturnType<typeof hubWith>, idp: ReturnType<typeof fakeIdp>) {
  const verifier = randomBytes(32).toString("base64url");
  const appState = "app-state-1234567890";
  const start = await hub.fetch(
    new Request(
      `${PUBLIC_URL}/auth/login?port=51234&state=${appState}&code_challenge=${s256(verifier)}`,
    ),
  );
  expect(start.status).toBe(302);
  const location = start.headers.get("location") ?? "";
  expect(location).toStartWith("https://idp.test/authorize?");
  expect(new URL(location).searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/auth/callback`);
  const { code, state } = idp.authorize(location);
  const back = await hub.fetch(
    new Request(`${PUBLIC_URL}/auth/callback?code=${code}&state=${state}`),
  );
  return { back, verifier, appState };
}

async function exchange(hub: ReturnType<typeof hubWith>, code: string, verifier: string) {
  return hub.fetch(
    new Request(`${PUBLIC_URL}/auth/token`, {
      method: "POST",
      body: JSON.stringify({ code, code_verifier: verifier }),
    }),
  );
}

describe("team hub", () => {
  test("full login hands the app a token that lists only permitted, sanitized connections", async () => {
    const idp = fakeIdp();
    const hub = hubWith(idp);
    const { back, verifier, appState } = await login(hub, idp);
    expect(back.status).toBe(302);
    const redirect = new URL(back.headers.get("location") ?? "");
    expect(redirect.origin).toBe("http://127.0.0.1:51234");
    expect(redirect.pathname).toBe("/callback");
    expect(redirect.searchParams.get("state")).toBe(appState);
    const code = redirect.searchParams.get("code") ?? "";

    expect((await exchange(hub, code, "wrong-verifier")).status).toBe(401);
    expect((await exchange(hub, code, verifier)).status).toBe(401);

    const second = await login(hub, idp);
    const secondCode = new URL(second.back.headers.get("location") ?? "").searchParams.get("code");
    const granted = await exchange(hub, secondCode ?? "", second.verifier);
    expect(granted.status).toBe(200);
    const body = (await granted.json()) as { token: string; user: { email: string } };
    expect(body.user.email).toBe("max@firma.test");

    const listed = await hub.fetch(
      new Request(`${PUBLIC_URL}/api/connections`, {
        headers: { authorization: `Bearer ${body.token}` },
      }),
    );
    const payload = (await listed.json()) as {
      name: string;
      connections: Record<string, unknown>[];
    };
    expect(payload.name).toBe("Firma");
    expect(payload.connections.map((entry) => entry.id)).toEqual(["erp", "lohn"]);
    expect(payload.connections[1]).not.toHaveProperty("groups");
    expect(payload.connections[1]).not.toHaveProperty("commandTunnel");
  });

  test("users outside a group do not see its connections", async () => {
    const idp = fakeIdp({ claims: { groups: [], roles: ["other"] } });
    const hub = hubWith(idp);
    const { back, verifier } = await login(hub, idp);
    const code = new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const { token } = (await (await exchange(hub, code, verifier)).json()) as { token: string };
    const listed = (await (
      await hub.fetch(
        new Request(`${PUBLIC_URL}/api/connections`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      )
    ).json()) as { connections: { id: string }[] };
    expect(listed.connections.map((entry) => entry.id)).toEqual(["erp"]);
  });

  test("app roles grant access like groups", async () => {
    const idp = fakeIdp({ claims: { groups: undefined, roles: ["grp-hr"] } });
    const hub = hubWith(idp);
    const { back, verifier } = await login(hub, idp);
    const code = new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const { token } = (await (await exchange(hub, code, verifier)).json()) as { token: string };
    const listed = (await (
      await hub.fetch(
        new Request(`${PUBLIC_URL}/api/connections`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      )
    ).json()) as { connections: { id: string }[] };
    expect(listed.connections.map((entry) => entry.id)).toEqual(["erp", "lohn"]);
  });

  for (const [label, claims] of [
    ["foreign issuer", { iss: "https://evil.test" }],
    ["foreign audience", { aud: "other-client" }],
    ["expired token", { exp: 10 }],
    ["replayed nonce", { nonce: "other" }],
    ["group overage marker", { groups: undefined, _claim_names: { groups: "src1" } }],
  ] as const) {
    test(`rejects an ID token with a ${label}`, async () => {
      const idp = fakeIdp({ claims });
      const hub = hubWith(idp);
      const { back } = await login(hub, idp);
      expect([401, 403]).toContain(back.status);
      expect(back.headers.get("location")).toBeNull();
    });
  }

  test("rejects unknown state, bad parameters, forged and expired hub tokens", async () => {
    const idp = fakeIdp();
    const hub = hubWith(idp, -1);
    expect(
      (await hub.fetch(new Request(`${PUBLIC_URL}/auth/callback?code=x&state=unknown`))).status,
    ).toBe(400);
    for (const query of [
      `port=80&state=app-state-1234567890&code_challenge=${"a".repeat(43)}`,
      `port=51234&state=short&code_challenge=${"a".repeat(43)}`,
      "port=51234&state=app-state-1234567890&code_challenge=short",
    ])
      expect((await hub.fetch(new Request(`${PUBLIC_URL}/auth/login?${query}`))).status).toBe(400);
    const { back, verifier } = await login(hub, idp);
    const code = new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const { token } = (await (await exchange(hub, code, verifier)).json()) as { token: string };
    const [payload, signature] = token.split(".");
    const forged = `${b64({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), exp: 9e9 })}.${signature}`;
    for (const bearer of [token, forged, "garbage"])
      expect(
        (
          await hub.fetch(
            new Request(`${PUBLIC_URL}/api/connections`, {
              headers: { authorization: `Bearer ${bearer}` },
            }),
          )
        ).status,
      ).toBe(401);
  });

  test("serves under a path prefix with or without a stripping reverse proxy", async () => {
    const hub = createHub(
      {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: "secret",
        publicUrl: "https://firma.test/l8db/",
        sessionSecret: "x".repeat(40),
        connectionsFile,
      },
      fakeIdp().fetcher,
    );
    for (const path of ["/l8db/health", "/health"])
      expect((await hub.fetch(new Request(`http://intern:8080${path}`))).status).toBe(200);
    const start = await hub.fetch(
      new Request(
        `http://intern:8080/l8db/auth/login?port=51234&state=app-state-1234567890&code_challenge=${"a".repeat(43)}`,
      ),
    );
    expect(new URL(start.headers.get("location") ?? "").searchParams.get("redirect_uri")).toBe(
      "https://firma.test/l8db/auth/callback",
    );
  });

  test("refuses connection files that carry passwords or invalid ids", () => {
    expect(() =>
      parseConnections(
        JSON.stringify({
          connections: [
            { id: "a", name: "A", kind: "postgres", connectionString: "postgres://u:pw@h/db" },
          ],
        }),
      ),
    ).toThrow("Passwort");
    expect(() =>
      parseConnections(
        JSON.stringify({
          connections: [
            { id: "a", name: "A", kind: "mssql", connectionString: "Server=h;Password=pw" },
          ],
        }),
      ),
    ).toThrow("Passwort");
    expect(() =>
      parseConnections(
        JSON.stringify({
          connections: [
            {
              id: "a",
              name: "A",
              kind: "postgres",
              connectionString: "postgres://h/db?Password=pw",
            },
          ],
        }),
      ),
    ).toThrow("Passwort");
    expect(() =>
      parseConnections(
        JSON.stringify({
          connections: [{ id: "a b", name: "A", kind: "x", connectionString: "x://h" }],
        }),
      ),
    ).toThrow("id");
  });
});

test("hub filters 5,000 connections for a user with 200 groups and reads the file once", async () => {
  const connections = Array.from({ length: 5000 }, (_, index) => ({
    id: `c${index}`,
    name: `Verbindung ${index}`,
    kind: "postgres",
    connectionString: `postgres://db${index}.intern:5432/app`,
    groups: index % 3 === 0 ? [] : [`grp-${index % 400}`],
  }));
  const groups = Array.from({ length: 200 }, (_, index) => `grp-${index}`);
  let visible = 0;
  const filtering = await measureScenario(() => {
    visible = visibleConnections(connections, groups).length;
  }, 15);
  reportScenario("team-hub-visible-connections", {
    connections: 5000,
    groups: 200,
    visible,
    ...filtering,
  });
  expect(visible).toBeGreaterThan(3000);
  expect(filtering.p95Ms).toBeLessThan(25);

  const file = join(dir, "large.json");
  writeFileSync(file, JSON.stringify({ connections }));
  const hub = createHub(
    {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "secret",
      publicUrl: PUBLIC_URL,
      sessionSecret: "x".repeat(40),
      connectionsFile: file,
    },
    fakeIdp().fetcher,
  );
  const first = await hub.loadConnections();
  const loading = await measureScenario(async () => {
    expect(await hub.loadConnections()).toBe(first);
  }, 15);
  reportScenario("team-hub-cached-connections", { connections: 5000, ...loading });
  expect(loading.p95Ms).toBeLessThan(5);
});
