import { afterEach, expect, test } from "bun:test";
import relay, { invalid, quiet } from "../services/issue-relay/src/index.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("issue relay rejects malformed reports and defuses mentions", () => {
  expect(invalid(null)).toBeTruthy();
  expect(invalid({ title: " ", body: "x" })).toContain("Titel");
  expect(invalid({ title: "t".repeat(201), body: "x" })).toContain("Titel");
  expect(invalid({ title: "😀".repeat(200), body: "x" })).toBeNull();
  expect(invalid({ title: "Absturz", body: "b".repeat(60_001) })).toContain("Beschreibung");
  expect(invalid({ title: "Absturz", body: "x", screenshot: "R0lGODlh" })).toContain("PNG");
  expect(invalid({ title: "Absturz", body: "x", screenshot: "iVBORw0KGgo!!!!" })).toContain("PNG");
  expect(invalid({ title: "Absturz", body: "x", screenshot: "iVBORw0KGgoAAAA=" })).toBeNull();
  expect(invalid({ title: "Absturz", body: "x" })).toBeNull();
  expect(quiet("hi @octocat and mail a@b")).toBe("hi @​octocat and mail a@​b");
});

test("issue relay stores the screenshot in R2 and embeds it in one issue", async () => {
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
  const stored: { key: string; bytes: Uint8Array; type?: string }[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = url.endsWith("/access_tokens")
      ? { token: "installation-token" }
      : { html_url: "https://github.com/Leon-Achteresch/l8db/issues/7", number: 7 };
    return new Response(JSON.stringify(answer), { status: 201 });
  }) as typeof fetch;
  const env = {
    REPOSITORY: "Leon-Achteresch/l8db",
    SCREENSHOT_BASE_URL: "https://pub-x.r2.dev/",
    GITHUB_APP_ID: "1",
    GITHUB_INSTALLATION_ID: "2",
    GITHUB_APP_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`,
    LIMITER: { limit: async () => ({ success: true }) },
    SCREENSHOTS: {
      put: async (
        key: string,
        bytes: Uint8Array,
        options: { httpMetadata: { contentType: string } },
      ) => void stored.push({ key, bytes, type: options.httpMetadata.contentType }),
    },
  };
  const payload = JSON.stringify({
    title: "Absturz @team",
    body: "Kaputt",
    screenshot: "iVBORw0KGgoAAAA=",
  });
  const send = () =>
    relay.fetch(
      new Request("https://relay.test/issues", {
        method: "POST",
        body: payload,
        headers: { "content-length": String(payload.length) },
      }),
      env,
    );
  const response = await send();
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    url: "https://github.com/Leon-Achteresch/l8db/issues/7",
    number: 7,
  });
  expect(stored).toHaveLength(1);
  expect(stored[0]?.type).toBe("image/png");
  expect([...(stored[0]?.bytes.slice(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
    "POST https://api.github.com/app/installations/2/access_tokens",
    "POST https://api.github.com/repos/Leon-Achteresch/l8db/issues",
    "PATCH https://api.github.com/repos/Leon-Achteresch/l8db/issues/7",
  ]);
  const issue = JSON.parse(String(calls[1]?.init.body));
  expect(issue.title).toBe("Absturz @​team");
  expect(issue.labels).toEqual(["bug", "ai-report"]);
  expect(issue.body).not.toContain("Screenshot");
  expect(stored[0]?.key.startsWith("7-")).toBe(true);
  expect(JSON.parse(String(calls[2]?.init.body)).body).toContain(
    `![Geschwärzter Screenshot](https://pub-x.r2.dev/${stored[0]?.key})`,
  );
  calls.length = 0;
  env.SCREENSHOTS.put = async () => {
    throw new Error("R2 down");
  };
  expect((await send()).status).toBe(201);
  expect(calls).toHaveLength(2);
});
