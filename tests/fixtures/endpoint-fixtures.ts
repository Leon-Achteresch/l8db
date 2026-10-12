import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { EndpointRequest, EndpointResult } from "../../src/lib/db";

interface FixtureEntry {
  kind: string;
  url: string;
  identity: EndpointResult["identity"];
  error: string | null;
}

const PATH = new URL("./connection-endpoints.json", import.meta.url).pathname;

const entries: FixtureEntry[] = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : [];

const index = new Map(entries.map((entry) => [`${entry.kind} ${entry.url}`, entry]));

const recording = process.env.L8DB_RECORD_ENDPOINTS === "1";

export function fixtureEndpoints(requests: EndpointRequest[]): EndpointResult[] {
  return requests.map((request) => {
    const key = `${request.kind} ${request.url}`;
    const entry = index.get(key);
    if (entry && entry.error !== "pending") return { identity: entry.identity, error: entry.error };
    if (!recording)
      throw new Error(
        `Endpunkt-Fixture fehlt: ${key}. L8DB_RECORD_ENDPOINTS=1 bun test, dann L8DB_UPDATE_ENDPOINT_FIXTURES=1 cargo test endpoint_fixtures.`,
      );
    if (!entry) {
      const pending = { kind: request.kind, url: request.url, identity: null, error: "pending" };
      entries.push(pending);
      index.set(key, pending);
      writeFileSync(PATH, `${JSON.stringify(entries, null, 2)}\n`);
    }
    return { identity: null, error: "pending" };
  });
}
