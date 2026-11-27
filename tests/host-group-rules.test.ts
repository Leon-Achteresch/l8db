import { expect, test } from "bun:test";
import {
  countHostRuleMatches,
  groupByServer,
  groupKey,
  matchesConnectionQuery,
  matchingHostRule,
  suggestHostPattern,
} from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";

const c = (id: string, host: string) =>
  ({
    id,
    name: id,
    kind: "postgres",
    sslMode: "disable",
    connectionString: `postgres://u@${host}:5432/db`,
  }) as unknown as SavedConnection;
test("rules", () => {
  const conns = [c("a", "cslbl01.corp"), c("b", "cslbl02.corp"), c("d", "other")];
  const groups = groupByServer(conns, [{ id: "r", name: "CSL", pattern: "x*, cslbl*" }]);
  expect(groups.map((g) => [g.label, g.connections.length])).toEqual([
    ["CSL", 2],
    ["other:5432/db", 1],
  ]);
  expect(suggestHostPattern(conns[0])).toBe("cslbl*");
});

test("search", () => {
  const connection = c("hr", "cslbl01.corp");
  expect(matchesConnectionQuery(connection, "HR")).toBe(true);
  expect(matchesConnectionQuery(connection, "cslbl")).toBe(true);
  expect(matchesConnectionQuery(connection, "missing")).toBe(false);
});

test("the first current rule owns each match after editing and reordering", () => {
  const connections = [c("a", "db1.corp"), c("b", "db2.corp"), c("c", "[::1]")];
  const broad = { id: "broad", name: "Büro", pattern: " , DB?.corp, " };
  const exact = { id: "exact", name: "Einzeln", pattern: "db1.corp:5432/db" };
  const local = { id: "v6", name: "", pattern: "::1" };
  const rules = [broad, exact, local];
  expect([...countHostRuleMatches(connections, rules)]).toEqual([
    ["broad", 2],
    ["v6", 1],
  ]);
  expect([...countHostRuleMatches(connections, [exact, broad, local])]).toEqual([
    ["exact", 1],
    ["broad", 1],
    ["v6", 1],
  ]);
  broad.pattern = "db2.corp";
  expect(matchingHostRule(connections[0], rules)).toBe(exact);
  expect(matchingHostRule(c("d", "db2xcorp"), rules)).toBeUndefined();
  const groups = groupByServer(connections, rules);
  expect(groups.map((group) => group.key)).toEqual(
    connections.map((entry) => groupKey(entry, rules)),
  );
  expect(groups.map((group) => group.label)).toEqual(["Einzeln", "Büro", "::1"]);
  expect(countHostRuleMatches(connections, [{ ...broad, pattern: "" }]).size).toBe(0);
});

test("grouping and match counts bound pattern compilation and endpoint reads", () => {
  const rules = Array.from({ length: 16 }, (_, i) => ({
    id: `r${i}`,
    name: `Team ${i}`,
    pattern: `alternate${i}-*, team${i}-*`,
  }));
  let reads = 0;
  const entries = Array.from({ length: 1024 }, (_, i) => {
    const url = `postgres://reader@team${i % 32}-db.corp:5432/db${i % 8}`;
    return {
      kind: "postgres" as const,
      get connectionString() {
        reads++;
        return url;
      },
    };
  });
  let compilations = 0;
  const originalRegExp = globalThis.RegExp;
  try {
    globalThis.RegExp = new Proxy(originalRegExp, {
      construct(target, args, newTarget) {
        compilations++;
        return Reflect.construct(target, args, newTarget);
      },
    });
    expect(groupByServer(entries, rules)).toHaveLength(32);
    expect(compilations).toBe(32);
    expect(reads).toBe(entries.length);
    const counts = countHostRuleMatches(entries, rules);
    expect([...counts.values()]).toEqual(Array(16).fill(32));
    expect(reads).toBe(2 * entries.length);
    expect(compilations).toBe(32);
    const edited = [{ ...rules[0], pattern: "team31-*" }, ...rules.slice(1)];
    expect(countHostRuleMatches(entries, edited).get("r0")).toBe(32);
    expect(compilations).toBe(33);
    reads = 0;
    expect(countHostRuleMatches(entries, []).size).toBe(0);
    expect(reads).toBe(0);
  } finally {
    globalThis.RegExp = originalRegExp;
  }
  for (const [name, run] of [
    ["group", () => groupByServer(entries, rules)],
    ["preview", () => countHostRuleMatches(entries, rules)],
  ] as const) {
    const samples: number[] = [];
    for (let i = 0; i < 22; i++) {
      const start = performance.now();
      run();
      if (i) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(name, "1024 connections, 16 rules", { median: samples[10], p95: samples[19] });
    expect(samples[10]).toBeLessThan(10);
    expect(samples[19]).toBeLessThan(24);
  }
});
