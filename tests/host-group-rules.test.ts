import { expect, test } from "bun:test";
import { groupByServer, matchesConnectionQuery, suggestHostPattern } from "@/lib/connection-groups";
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
  const conns = [c("a", "db-prod01.corp"), c("b", "db-prod02.corp"), c("d", "other")];
  const groups = groupByServer(conns, [{ id: "r", name: "Prod", pattern: "x*, db-prod*" }]);
  expect(groups.map((g) => [g.label, g.connections.length])).toEqual([
    ["CSL", 2],
    ["other:5432/db", 1],
  ]);
  expect(suggestHostPattern(conns[0])).toBe("db-prod*");
});

test("search", () => {
  const connection = c("hr", "db-prod01.corp");
  expect(matchesConnectionQuery(connection, "HR")).toBe(true);
  expect(matchesConnectionQuery(connection, "db-prod")).toBe(true);
  expect(matchesConnectionQuery(connection, "missing")).toBe(false);
});
