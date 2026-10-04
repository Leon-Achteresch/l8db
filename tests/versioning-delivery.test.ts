import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => null,
}));

const { useConnectionsStore } = await import("../src/lib/connections/store");
const { blockingGate, promotionSources, runRequest, targetStage } = await import(
  "../src/lib/versioning/delivery"
);
const { pullRequestBody } = await import("../src/lib/versioning/forge");
const { parseTeamConfiguration } = await import("../src/lib/versioning/team");

import type {
  DatabaseRelease,
  DatabaseTarget,
  VersioningProject,
} from "../src/lib/versioning/types";

const project: VersioningProject = {
  format: 1,
  id: "project",
  name: "Shop",
  kind: "postgres",
  objects: [],
};

function target(id: string, extra: Partial<DatabaseTarget>): DatabaseTarget {
  return {
    id,
    name: id,
    customer: "Stadtwerke Nord",
    connectionId: `${id}-connection`,
    database: "app",
    schema: "shop",
    production: false,
    release: null,
    history: [],
    ...extra,
  };
}

function team(targetFields: Record<string, unknown>) {
  return JSON.stringify({
    format: 1,
    projectId: "project",
    connections: [
      {
        id: "server",
        name: "Server",
        kind: "postgres",
        host: "db.example.invalid",
        port: "5432",
        service: null,
        sslMode: "require",
        requiresTunnel: false,
      },
    ],
    targets: [
      {
        id: "test",
        name: "Test",
        connectionRef: "server",
        database: "app",
        schema: "shop",
        production: false,
        ...targetFields,
      },
    ],
    branches: {},
  });
}

describe("delivery stages", () => {
  test("team configuration accepts only consistent stages", () => {
    expect(parseTeamConfiguration(team({ stage: "test" }), "project").targets[0].stage).toBe(
      "test",
    );
    expect(() => parseTeamConfiguration(team({ stage: "development" }), "project")).not.toThrow();
    expect(() => parseTeamConfiguration(team({ stage: "production" }), "project")).toThrow();
    expect(() => parseTeamConfiguration(team({ stage: "staging" }), "project")).toThrow();
    expect(() =>
      parseTeamConfiguration(team({ stage: "production", production: true }), "project"),
    ).not.toThrow();
  });

  test("stage falls back to the production flag and the environment name", () => {
    expect(targetStage({ production: true, stage: undefined })).toBe("production");
    expect(targetStage({ production: false, stage: "development" })).toBe("development");
    expect(targetStage({ production: false, environment: "Development" })).toBe("development");
    expect(targetStage({ production: false, environment: "Staging" })).toBe("test");
  });
});

describe("test before production", () => {
  test("only explicit test systems of the same customer are offered as evidence", async () => {
    useConnectionsStore.setState({
      connections: [
        {
          id: "test-a-connection",
          name: "Test A",
          kind: "postgres",
          sslMode: "require",
          connectionString: "postgres://deploy@test.example.invalid:5432/app",
        },
        {
          id: "test-b-connection",
          name: "Test B",
          kind: "postgres",
          sslMode: "require",
          connectionString: "postgres://deploy@other.example.invalid:5432/app",
        },
        {
          id: "dev-connection",
          name: "Dev",
          kind: "postgres",
          sslMode: "require",
          connectionString: "postgres://deploy@dev.example.invalid:5432/app",
        },
      ] as never,
    });
    const production = target("prod", { production: true, stage: "production" });
    const targets = [
      production,
      target("test-a", { stage: "test", ledgerSchema: "ledger" }),
      target("test-b", { stage: "test", customer: "Andere GmbH" }),
      target("dev", { stage: "development" }),
      target("implicit", { environment: "Staging" }),
      target("orphan", { stage: "test", connectionId: "missing" }),
      target("other-prod", { production: true, stage: "production" }),
    ];
    const sources = await promotionSources(production, targets, project);
    expect(sources.promotion.map((entry) => entry.targetId)).toEqual(["test-a"]);
    expect(sources.promotion[0].connection).toMatchObject({
      kind: "postgres",
      database: "app",
      schema: "ledger",
      projectId: "project",
      readOnly: false,
    });
    expect(sources.problems).toEqual([
      "implicit: Stufe „Test“ in den Zieldetails festlegen",
      "orphan: lokale Verbindung fehlt",
    ]);
    expect(await promotionSources(targets[1], targets, project)).toEqual({
      promotion: [],
      problems: [],
    });
    const request = runRequest(
      "/repo",
      project,
      production,
      {
        id: "prod-connection",
        name: "Prod",
        kind: "postgres",
        sslMode: "require",
        connectionString: "postgres://deploy@prod.example.invalid:5432/app",
      } as never,
      "{}",
      sources.promotion,
    );
    expect(request.promotion).toHaveLength(1);
    expect(request.connection.schema).toBe("shop");
    expect(request.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("the first failing gate blocks the rollout", () => {
    expect(blockingGate(null)).toBeNull();
    const report = {
      rules: { repository: "github.com/acme/shop", review: true, approvals: 1, testFirst: true },
      gates: [
        { id: "repository" as const, ok: true, detail: "", evidence: [] },
        { id: "merged" as const, ok: false, detail: "nicht gemergt", evidence: [] },
      ],
    };
    expect(blockingGate(report)?.id).toBe("merged");
  });
});

describe("pull request description", () => {
  test("lists releases, migrations, risks, files and the review checklist", () => {
    const release = {
      format: 1,
      id: "2026-10-01-orders",
      projectId: "project",
      kind: "postgres",
      parent: null,
      createdAt: "2026-10-01T10:00:00Z",
      objects: [],
      migrations: [
        {
          id: "m1",
          title: "Spalte status entfernen",
          sql: "ALTER TABLE shop.orders DROP COLUMN status;",
          checksum: "x",
        },
      ],
      safety: {
        phase: "contract",
        compatibility: "maintenance",
        notes: "Nur nach Umstellung der App",
        lockTimeoutMs: 1000,
        statementTimeoutMs: 1000,
        preconditions: [],
        postconditions: [],
      },
    } as DatabaseRelease;
    const body = pullRequestBody(
      [release],
      [
        { status: "A", path: "database/releases/2026-10-01-orders.json" },
        { status: "M", path: "database/objects/orders.sql" },
      ],
    );
    expect(body).toContain(
      "**2026-10-01-orders** · Linie main · 1 Migration · contract, Wartungsfenster",
    );
    expect(body).toContain("  - Spalte status entfernen");
    expect(body).toContain("Contract: Alte Anwendungsversionen");
    expect(body).toContain("Hinweis: Nur nach Umstellung der App");
    expect(body).toContain("- neu: `database/releases/2026-10-01-orders.json`");
    expect(body).toContain("- geändert: `database/objects/orders.sql`");
    expect(body).toContain("## Prüfliste");
  });
});
