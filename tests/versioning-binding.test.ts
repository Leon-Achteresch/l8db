import { expect, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import { bindingForContext, bindingMatches } from "../src/lib/versioning/binding";
import type { DatabaseTarget } from "../src/lib/versioning/types";

const connection = {
  id: "production",
  kind: "postgres",
  connectionString: "postgresql://admin:secret@db.example/product",
} as SavedConnection;
const target = { database: "product", schema: "public", ledgerSchema: "public" } as DatabaseTarget;
const context = {
  database: "product",
  user: "admin",
  server: "10.0.0.2",
  port: "5432",
  edition: null,
};

test("authorized operators share a physical baseline while reviews remain bound to their own identity", async () => {
  const baseline = await bindingForContext(connection, target, context);
  const operator = await bindingForContext(
    { ...connection, connectionString: "postgresql://operator:other-secret@db.example/product" },
    target,
    { ...context, user: "operator" },
  );
  expect(bindingMatches(baseline, operator)).toBe(true);
  expect(baseline.fingerprint).not.toBe(operator.fingerprint);
  expect(baseline.physicalKey).toBe(operator.physicalKey);
  expect(JSON.stringify(operator)).not.toContain("other-secret");
});

test("location, database, schema and edition changes still invalidate a baseline", async () => {
  const baseline = await bindingForContext(connection, target, context);
  for (const [nextConnection, nextTarget, nextContext] of [
    [
      {
        ...connection,
        connectionString: connection.connectionString.replace("db.example", "other.example"),
      },
      target,
      context,
    ],
    [connection, target, { ...context, database: "different" }],
    [connection, { ...target, schema: "other" }, context],
    [connection, target, { ...context, edition: "NEXT_EDITION" }],
  ] as const) {
    expect(
      bindingMatches(baseline, await bindingForContext(nextConnection, nextTarget, nextContext)),
    ).toBe(false);
  }
  const legacy = { ...baseline, locationFingerprint: undefined };
  const operator = await bindingForContext(connection, target, { ...context, user: "operator" });
  expect(bindingMatches(legacy, operator)).toBe(false);
});
