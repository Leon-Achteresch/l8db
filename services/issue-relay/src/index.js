const MAX_REQUEST_BYTES = 4_000_000;
const MAX_TITLE = 200;
const MAX_BODY = 60_000;
const PNG_PREFIX = "iVBORw0KGgo";
const LABELS = ["bug", "ai-report"];

export default {
  async fetch(request, env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/issues")
      return reply({ error: "Nicht gefunden." }, 404);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.LIMITER.limit({ key: ip })).success)
      return reply({ error: "Zu viele Berichte. Bitte in einer Minute erneut versuchen." }, 429);
    if (Number(request.headers.get("content-length") ?? MAX_REQUEST_BYTES + 1) > MAX_REQUEST_BYTES)
      return reply({ error: "Bericht ist zu groß." }, 413);
    const report = await request.json().catch(() => null);
    const problem = invalid(report);
    if (problem) return reply({ error: problem }, 400);
    try {
      const token = await installationToken(env, request.signal);
      const body = `${quiet(report.body)}\n\n_Automatisch aus l8db gemeldet._`;
      const issue = await github(
        token,
        `/repos/${env.REPOSITORY}/issues`,
        {
          method: "POST",
          body: JSON.stringify({ title: quiet(report.title.trim()), body, labels: LABELS }),
        },
        request.signal,
      );
      const base = env.SCREENSHOT_BASE_URL?.replace(/\/$/, "");
      if (report.screenshot && base?.startsWith("https://") && !base.includes("REPLACE")) {
        const key = `${issue.number}-${crypto.randomUUID()}.png`;
        try {
          await env.SCREENSHOTS.put(key, decodeScreenshot(report.screenshot), {
            httpMetadata: { contentType: "image/png" },
          });
          await github(
            token,
            `/repos/${env.REPOSITORY}/issues/${issue.number}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                body: `${body}\n\n![Geschwärzter Screenshot](${base}/${key})`,
              }),
            },
            request.signal,
          );
        } catch (error) {
          console.error(error);
        }
      }
      return reply({ url: issue.html_url, number: issue.number }, 201);
    } catch (error) {
      console.error(error);
      return reply({ error: "GitHub hat den Bericht nicht angenommen." }, 502);
    }
  },
};

function decodeScreenshot(base64) {
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

export function invalid(report) {
  if (!report || typeof report !== "object") return "Ungültiger Bericht.";
  const { title, body, screenshot } = report;
  if (typeof title !== "string" || !title.trim() || [...title].length > MAX_TITLE)
    return `Titel fehlt oder ist länger als ${MAX_TITLE} Zeichen.`;
  if (typeof body !== "string" || !body.trim() || [...body].length > MAX_BODY)
    return `Beschreibung fehlt oder ist länger als ${MAX_BODY} Zeichen.`;
  if (
    screenshot != null &&
    (typeof screenshot !== "string" ||
      !screenshot.startsWith(PNG_PREFIX) ||
      screenshot.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(screenshot))
  )
    return "Screenshot muss ein PNG sein.";
  return null;
}

export function quiet(text) {
  return text.replace(/@(?=[\w-])/g, "@​");
}

function reply(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function github(token, path, init, signal) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "l8db-issue-relay",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function installationToken(env, signal) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })}`;
  const der = Uint8Array.from(
    atob(env.GITHUB_APP_PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, "")),
    (char) => char.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const answer = await github(
    `${unsigned}.${base64url(new Uint8Array(signature))}`,
    `/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    { method: "POST" },
    signal,
  );
  return answer.token;
}

function encode(value) {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
