import { runFetch } from "@/lib/extensions/host";
import { type HttpInit, type HttpResponse, httpPatternMatches } from "./api";
import type { ActivePlugin } from "./registry";
import { uiPluginRegistry } from "./store";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function pluginHttp(
  plugin: ActivePlugin,
  url: string,
  init: HttpInit = {},
): Promise<HttpResponse> {
  if (typeof url !== "string" || !url.startsWith("https://"))
    throw new Error("ctx.http erlaubt nur https://-Adressen.");
  if (!plugin.definition.http.some((pattern) => httpPatternMatches(pattern, url)))
    throw new Error(`Ziel ${url} steht nicht in permissions.http von ${plugin.id}.`);
  const current = uiPluginRegistry().plugins.find((entry) => entry.id === plugin.id);
  if (!current) throw new Error(`„${plugin.name}“ ist deaktiviert oder entfernt.`);
  if (!current.http.some((pattern) => httpPatternMatches(pattern, url)))
    throw new Error(
      `Netzwerkzugriff für „${plugin.name}“ ist nicht freigegeben. Einstellungen → Erweiterungen → UI-Plugins.`,
    );
  const method = (init.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) throw new Error(`Methode ${method} ist nicht erlaubt.`);
  const headers = init.headers ?? {};
  if (
    typeof headers !== "object" ||
    Object.keys(headers).length > 20 ||
    Object.entries(headers).some(
      ([key, value]) => typeof value !== "string" || key.length > 256 || value.length > 4096,
    )
  )
    throw new Error("ctx.http: ungültige Header.");
  if (init.body !== undefined && (typeof init.body !== "string" || init.body.length > 262144))
    throw new Error("ctx.http: body muss ein Text bis 256 KB sein.");
  const response = await runFetch(url, {
    method,
    headers,
    body: init.body,
    timeoutMs: Math.min(30000, Math.max(1, init.timeoutMs ?? 15000)),
  });
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: async () => response.body,
    json: async () => JSON.parse(response.body),
  };
}
