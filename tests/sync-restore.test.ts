import { expect, mock, test } from "bun:test";

const calls: { command: string; args: Record<string, unknown> | undefined }[] = [];
let lease: string | null = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "sync_begin") return lease;
    if (command === "sync_end") return true;
    if (command === "sync_backup_restore_secrets")
      return { restored: ["conn-restored"], failed: [], backup: null };
    return null;
  },
  transformCallback: () => 1,
}));

const { restoreBackup } = await import("../src/lib/sync/controller");
const { readSecretEdits } = await import("../src/lib/secret-edits");

test("restoring a backup refuses while another window holds the sync lease", async () => {
  lease = null;
  calls.length = 0;
  await expect(
    restoreBackup({ id: "1-passwoerter", hasData: false, hasSecrets: true }),
  ).rejects.toThrow("Synchronisierung läuft gerade");
  expect(calls.map((call) => call.command)).toEqual(["sync_begin"]);
});

test("restoring a backup runs under the lease and releases its token", async () => {
  lease = "token-1";
  calls.length = 0;
  await restoreBackup({ id: "1-passwoerter", hasData: false, hasSecrets: true });
  expect(calls.map((call) => call.command)).toEqual([
    "sync_begin",
    "sync_backup_restore_secrets",
    "sync_end",
  ]);
  expect(calls[2].args).toEqual({ token: "token-1" });
  expect(readSecretEdits()["conn-restored"]).toBeNumber();
});
