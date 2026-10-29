import type { FetchOptions } from "./contracts";
import { ExtensionError } from "./contracts";

const FETCH_BODY_LIMIT = 1024 * 1024;

export async function runFetch(url: string, options: FetchOptions) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "error",
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!(key in headers)) headers[key] = value;
    });
    const text = await response.text();
    if (text.length > FETCH_BODY_LIMIT)
      throw new ExtensionError("ProtocolError", "Response body exceeds 1 MiB");
    return { status: response.status, headers, body: text };
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    throw new ExtensionError("NetworkError", String(error));
  } finally {
    clearTimeout(timer);
  }
}
