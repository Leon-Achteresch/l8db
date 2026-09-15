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
