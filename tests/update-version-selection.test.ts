import { beforeEach, expect, mock, test } from "bun:test";
import { Update } from "@tauri-apps/plugin-updater";

const calls: { command: string; args?: Record<string, unknown> }[] = [];
let gate: Promise<void> | null = null;
let failure = false;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "check_update") {
      await gate;
      if (failure) throw new Error("manifest unavailable");
      return {
        rid: 7,
        currentVersion: "0.18.0-canary.100",
        version: args?.version ?? "0.19.0",
        rawJson: {},
      };
    }
    if (command === "list_update_releases") {
      await gate;
      return { versions: ["0.17.0"], nextPage: null };
    }
    return null;
  },
}));

const { useSettingsStore } = await import("../src/lib/settings");
const { checkUpdate, listUpdateReleases } = await import("../src/lib/db/updates");
const {
  checkForUpdates,
  closeUpdatePrompt,
  getPendingUpdate,
  getUpdatePromptState,
  presentUpdate,
  setPendingUpdate,
} = await import("../src/lib/updater");

beforeEach(async () => {
  setPendingUpdate(null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  calls.length = 0;
  gate = null;
  failure = false;
  useSettingsStore.setState({ updateChannel: "canary" });
});

test("explicit selection forwards the exact older version without changing the channel", async () => {
  const result = await checkUpdate("canary", 20_000, "0.9.1");
  expect(result?.version).toBe("0.9.1");
  expect(calls).toEqual([
    { command: "check_update", args: { channel: "canary", timeout: 20_000, version: "0.9.1" } },
  ]);
  expect(useSettingsStore.getState().updateChannel).toBe("canary");
  expect(getPendingUpdate()).toBeNull();
});

test("normal checks retain their channel-only request and report failures", async () => {
  expect((await checkForUpdates())?.version).toBe("0.19.0");
  expect(calls[0].args).toEqual({ channel: "canary", timeout: 20_000 });
  failure = true;
  await expect(checkForUpdates()).rejects.toThrow("manifest unavailable");
});

test("manual confirmation pauses automatic checks and survives dismiss/reopen", async () => {
  const metadata = await checkUpdate("canary", 20_000, "0.17.0");
  if (!metadata) throw new Error("Missing selected release");
  const update = new Update(metadata);
  presentUpdate(update, true);
  const before = calls.length;
  expect(await checkForUpdates()).toBeNull();
  expect(calls).toHaveLength(before);
  closeUpdatePrompt();
  expect(getUpdatePromptState().open).toBe(false);
  presentUpdate(update);
  expect(getUpdatePromptState()).toEqual({ open: true, update, manual: true });
});

test("in-flight automatic results cannot replace a manually chosen downgrade", async () => {
  let resume = () => {};
  gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const pending = checkForUpdates();
  const chosen = new Update({
    rid: 8,
    currentVersion: "0.18.0-canary.100",
    version: "0.9.1",
    rawJson: {},
  });
  presentUpdate(chosen, true);
  resume();
  expect(await pending).toBeNull();
  expect(getPendingUpdate()).toBe(chosen);
  expect(calls.filter((call) => call.command === "plugin:resources|close").at(-1)?.args).toEqual({
    rid: 7,
  });
});

test("results from an abandoned channel are released; replacement releases the old update", async () => {
  let resume = () => {};
  gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const pending = checkForUpdates();
  useSettingsStore.setState({ updateChannel: "stable" });
  resume();
  expect(await pending).toBeNull();
  expect(getPendingUpdate()).toBeNull();
  expect(calls.filter((call) => call.command === "plugin:resources|close")).toHaveLength(1);
  presentUpdate(
    new Update({ rid: 8, currentVersion: "0.18.0", version: "0.9.1", rawJson: {} }),
    true,
  );
  presentUpdate(
    new Update({ rid: 9, currentVersion: "0.18.0", version: "0.9.0", rawJson: {} }),
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls.filter((call) => call.command === "plugin:resources|close").at(-1)?.args).toEqual({
    rid: 8,
  });
});

test("history cancellation reaches the native request and releases the abort listener", async () => {
  let resume = () => {};
  gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const controller = new AbortController();
  const pending = listUpdateReleases("canary", 1, controller.signal);
  controller.abort();
  expect(calls.map((call) => call.command)).toEqual([
    "list_update_releases",
    "cancel_update_release_request",
  ]);
  expect(calls[1].args?.requestId).toBe(calls[0].args?.requestId);
  resume();
  await pending;
  const finished = new AbortController();
  await listUpdateReleases("stable", 2, finished.signal);
  const beforeAbort = calls.length;
  finished.abort();
  expect(calls).toHaveLength(beforeAbort);
  await expect(listUpdateReleases("stable", 1, controller.signal)).rejects.toThrow();
  expect(calls).toHaveLength(beforeAbort);
});
