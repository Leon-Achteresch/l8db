import { describe, expect, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections/types";
import {
  createTeamConfiguration,
  mergeTeamTargets,
  parseTeamConfiguration,
} from "../src/lib/versioning/team";
import type { DatabaseTarget, TargetStore, TeamConfiguration } from "../src/lib/versioning/types";

const connection: SavedConnection = {
  id: "private-profile-id",
  name: "Customer A server",
  kind: "postgres",
  connectionString:
    "postgres://private-user:private-password@db.example.invalid:5432/app?token=private-token",
  sslMode: "verify-full",
  ssh: {
    host: "bastion.example.invalid",
    port: 22,
    user: "private-ssh-user",
    auth: "key",
    keyFile: "/private/key",
    remoteHost: "db.example.invalid",
    remotePort: 5432,
  },
};
const target: DatabaseTarget = {
  id: "customer-a",
  name: "Customer A Production",
  customer: "Customer A",
  environment: "Production",
  connectionId: connection.id,
  database: "app",
  schema: "customer_a",
  production: true,
  binding: {
    fingerprint: "a".repeat(64),
    physicalKey: "b".repeat(64),
    label: "private-user @ app",
    edition: null,
  },
  release: { id: "v1", commit: "a".repeat(40), path: "database/releases/v1.json" },
  history: [],
  requireApproval: true,
  reviewers: ["release_reviewer"],
  operators: ["release_operator"],
};
const store = (): TargetStore => ({
  format: 1,
  projectId: "project",
  targets: [structuredClone(target)],
});

describe("shared database team configuration", () => {
  test("exports reviewed target settings without credentials, local profile IDs or execution state", () => {
    const local = store();
    const team = createTeamConfiguration(local, [connection]);
    const raw = JSON.stringify(team);
    for (const secret of [
      "private-user",
      "private-password",
      "private-token",
      "/private/key",
      "private-profile-id",
      "connectionString",
      "history",
      "fingerprint",
      '"release"',
    ])
      expect(raw).not.toContain(secret);
    expect(team.connections[0]).toMatchObject({
      host: "db.example.invalid",
      sslMode: "verify-full",
      requiresTunnel: true,
    });
    expect(team.targets[0]).toMatchObject({
      customer: "Customer A",
      production: true,
      requireApproval: true,
      expectedPhysicalKey: "b".repeat(64),
    });
    expect(team.targets[0].connectionRef).not.toBe(connection.id);
  });
  test("a fresh clone requires local profile mapping and a live database baseline", () => {
    const team = createTeamConfiguration(store(), [connection]);
    const cloned = mergeTeamTargets({ format: 1, projectId: "project", targets: [] }, team);
    expect(cloned.targets[0]).toMatchObject({
      connectionId: "",
      release: null,
      history: [],
      production: true,
    });
    expect(cloned.targets[0].binding).toBeUndefined();
    expect(cloned.connections).toEqual(team.connections);
  });
  test("local runtime state survives branch changes only for the same pinned database identity", () => {
    const local = store();
    const team = createTeamConfiguration(local, [connection]);
    expect(mergeTeamTargets(local, team).targets[0].release).toEqual(target.release);
    for (const change of [
      { schema: "customer_b" },
      { database: "other" },
      { expectedPhysicalKey: "c".repeat(64) },
    ]) {
      const edited = structuredClone(team);
      Object.assign(edited.targets[0], change);
      const merged = mergeTeamTargets(local, edited).targets[0];
      expect(merged.release).toBeNull();
      expect(merged.binding).toBeUndefined();
    }
  });
  test("rejects secret-bearing fields and broken shared references", () => {
    const team = createTeamConfiguration(store(), [connection]);
    for (const mutate of [
      (value: TeamConfiguration) => {
        Object.assign(value.connections[0], { password: "secret" });
      },
      (value: TeamConfiguration) => {
        Object.assign(value.targets[0], { connectionId: "local" });
      },
      (value: TeamConfiguration) => {
        value.targets[0].connectionRef = "missing";
      },
      (value: TeamConfiguration) => {
        value.connections.push(value.connections[0]);
      },
      (value: TeamConfiguration) => {
        value.branches.main = { targetId: "missing" };
      },
    ]) {
      const edited = structuredClone(team);
      mutate(edited);
      expect(() => parseTeamConfiguration(JSON.stringify(edited), "project")).toThrow();
    }
  });
});
