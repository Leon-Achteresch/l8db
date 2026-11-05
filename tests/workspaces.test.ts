import { beforeEach, expect, mock, test } from "bun:test";

const calls: { command: string; args: Record<string, unknown> }[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "workspace_request") return { items: [], more: false };
    return null;
  },
}));
const bridge = await import("../src/lib/db/workspaces");

beforeEach(() => {
  calls.length = 0;
});

test("workspace login and requests centralize credentials in the backend bridge", async () => {
  await bridge.workspaceLogin("https://team.example.test", "member@example.test", "user-password");
  await bridge.workspaceRequest("profile", "GET", "users", { offset: 100 });
  await bridge.workspaceAcceptInvitation(
    "https://team.example.test",
    "invitation",
    "member@example.test",
    "new-password",
  );
  expect(calls).toEqual([
    {
      command: "workspace_login",
      args: {
        endpoint: "https://team.example.test",
        email: "member@example.test",
        password: "user-password",
      },
    },
    {
      command: "workspace_request",
      args: {
        request: { profile: "profile", method: "GET", path: "users", body: { offset: 100 } },
      },
    },
    {
      command: "workspace_accept_invitation",
      args: {
        endpoint: "https://team.example.test",
        token: "invitation",
        email: "member@example.test",
        password: "new-password",
      },
    },
  ]);
});

test("workspace jobs expose cancellation with a stable job id and bounded result rows", async () => {
  await bridge.workspaceRunQuery("profile", "database", "SELECT name FROM items", "job-1");
  await bridge.workspaceCancelQuery("profile", "database", "job-1");
  expect(calls.map((call) => call.args)).toEqual([
    {
      request: {
        profile: "profile",
        method: "POST",
        path: "connections/database/query",
        body: { sql: "SELECT name FROM items", jobId: "job-1", maxRows: 1000 },
      },
    },
    {
      request: {
        profile: "profile",
        method: "POST",
        path: "connections/database/cancel",
        body: { jobId: "job-1" },
      },
    },
  ]);
  const address = bridge.workspaceConnectionUrl("profile-123", "database-456");
  expect(address).toBe("workspace://profile-123/database-456");
  expect(new URL(address).password).toBe("");
});
