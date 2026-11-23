import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { type SavedQuery, saveNamedQuery, useSavedQueriesStore } from "../src/lib/saved-queries";
import { serializeSavedQueryExport } from "../src/lib/saved-queries-transfer";
import {
  matchesSavedQuerySearch,
  savedQueryConnectionNames,
  savedQueryOriginInfo,
  storedSavedQueries,
} from "../src/lib/saved-query-origin";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("5,000 saved queries keep context resolution/search and one persisted save bounded without requests or idle writes", async () => {
  const connections = Array.from({ length: 250 }, (_, index) => ({
    id: `c${index}`,
    name: `Connection ${index}`,
  }));
  const queries: SavedQuery[] = Array.from({ length: 5_000 }, (_, index) => ({
    id: `q${index}`,
    name: `Query ${index}`,
    sql: `SELECT ${index} AS id`,
    createdAt: index + 1,
    ...(index % 2
      ? {
          origin: {
            connectionId: `c${index % connections.length}`,
            connectionName: `Connection ${index % connections.length}`,
            database: "app",
          },
        }
      : {}),
  }));
  const renderData = () => {
    const names = savedQueryConnectionNames(connections);
    let matches = 0;
    for (const query of queries) {
      if (!savedQueryOriginInfo(query.origin, names).label) throw Error("missing label");
      matches += Number(matchesSavedQuerySearch(query, "app", names));
    }
    if (matches !== 2_500) throw Error("wrong mixed search");
  };
  useSavedQueriesStore.setState({ queries });
  const save = () => {
    saveNamedQuery("Query 1", "SELECT 1 AS id", queries[1].origin ?? null);
  };
  const list = await measureScenario(renderData, 9);
  const persistence = await measureScenario(save, 9);
  const transfer = await measureScenario(() => {
    serializeSavedQueryExport(queries);
  }, 9);
  Bun.gc(true);
  const before = heapStats().heapSize;
  const text = serializeSavedQueryExport(queries);
  const restored = storedSavedQueries(JSON.parse(text).queries);
  for (let index = 0; index < 5; index++) {
    renderData();
    save();
  }
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  const idle = window.localStorage.getItem("l8db.saved-queries");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(window.localStorage.getItem("l8db.saved-queries")).toBe(idle);
  expect(restored).toHaveLength(5_000);
  reportScenario("saved-query-origin", {
    queries: queries.length,
    connections: connections.length,
    list,
    persistence,
    transfer,
    serializedChars: text.length,
    retainedBytes,
    dbRequests: 0,
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramBytes: totalmem(),
      bun: Bun.version,
    },
  });
  for (const times of [list, persistence, transfer]) {
    expect(times.medianMs).toBeLessThan(100);
    expect(times.p95Ms).toBeLessThan(200);
  }
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
  expect(text.length).toBeLessThan(4 * 1024 * 1024);
});
