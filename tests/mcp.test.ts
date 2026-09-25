import { expect, test } from "bun:test";
import type { SavedConnection } from "@/lib/connections";
import {
  type McpConnection,
  mcpSupported,
  mergeMcpConnections,
  sameMcpConnections,
} from "@/lib/mcp";

const saved = (over: Partial<SavedConnection>): SavedConnection =>
  ({
    id: "a",
    name: "A",
    kind: "postgres",
    sslMode: "prefer",
    connectionString: "postgres://u:secret@h:5432/db?sslmode=require",
    ...over,
  }) as SavedConnection;

test("merge scrubs passwords, keeps settings, drops removed", () => {
  const existing: McpConnection[] = [
    {
      id: "a",
      name: "old",
      kind: "postgres",
      connectionString: "x",
      schemas: [],
      ssh: false,
      exposed: true,
      readOnly: false,
      allowDdl: true,
      redactColumns: ["geheim"],
    },
    {
      id: "gone",
      name: "gone",
      kind: "mysql",
      connectionString: "y",
      schemas: [],
      ssh: false,
      exposed: true,
      readOnly: true,
      allowDdl: false,
      redactColumns: [],
    },
  ];
  const merged = mergeMcpConnections(
    [
      saved({}),
      saved({ id: "b", name: "B", schemas: ["public"], ssh: { host: "bastion" } as never }),
    ],
    existing,
  );
  expect(merged.map((c) => c.id)).toEqual(["a", "b"]);
  expect(merged[0]).toMatchObject({
    name: "A",
    connectionString: "postgres://u@h:5432/db?sslmode=require",
    exposed: true,
    readOnly: false,
    allowDdl: true,
    redactColumns: ["geheim"],
  });
  expect(merged[1]).toMatchObject({
    exposed: false,
    readOnly: true,
    allowDdl: false,
    ssh: true,
    schemas: ["public"],
  });
  expect(
    sameMcpConnections(
      merged,
      mergeMcpConnections(
        [
          saved({}),
          saved({ id: "b", name: "B", schemas: ["public"], ssh: { host: "bastion" } as never }),
        ],
        merged,
      ),
    ),
  ).toBe(true);
  expect(sameMcpConnections(merged, existing)).toBe(false);
});

test("support rules", () => {
  expect(mcpSupported(saved({}))).toBeNull();
  expect(mcpSupported(saved({ kind: "mongodb" }))).toBeNull();
  expect(mcpSupported(saved({ kind: "redis" }))).toBeNull();
  expect(mcpSupported(saved({ ssh: { host: "x" } as never }))).toContain("SSH");
});

test("merge überträgt Umgebung, Maskierungsregeln und Produktionsfreigabe", () => {
  const rule = { name: "mail", pattern: "email", enabled: true, mask: "partial" as const };
  const [first] = mergeMcpConnections(
    [saved({ environment: "production", maskRules: [rule] })],
    [{ ...mergeMcpConnections([saved({})], [])[0], allowProductionWrites: true }],
  );
  expect(first.environment).toBe("production");
  expect(first.maskRules).toEqual([rule]);
  expect(first.allowProductionWrites).toBe(true);
  const [plain] = mergeMcpConnections([saved({})], []);
  expect(plain.environment).toBeNull();
  expect(plain.allowProductionWrites).toBe(false);
});
