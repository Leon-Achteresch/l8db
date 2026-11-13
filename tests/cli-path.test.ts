import { expect, mock, test } from "bun:test";
import type { CliState, CliStatus } from "../src/lib/db/cli";

let calls = 0;
let next: CliStatus | Error = status("missing");

function status(state: CliState): CliStatus {
  return {
    installed: state === "ready",
    state,
    command: "l8db",
    location: state === "missing" ? null : "/usr/local/bin/l8db",
    target: "/Applications/l8db.app/Contents/MacOS/l8db",
  };
}

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  invoke: async (command: string) => {
    if (command !== "cli_status") throw new Error(command);
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (next instanceof Error) throw next;
    return next;
  },
}));

const { cliNeedsAction, initCliPathCheck, useCliPath } = await import("../src/lib/cli-path");

test("only a missing or unreachable command asks for action", () => {
  expect(cliNeedsAction(null)).toBe(false);
  expect(cliNeedsAction(status("ready"))).toBe(false);
  expect(cliNeedsAction(status("other"))).toBe(false);
  expect(cliNeedsAction(status("missing"))).toBe(true);
  expect(cliNeedsAction(status("not_on_path"))).toBe(true);
});

test("concurrent refreshes share one request and a failure raises no hint", async () => {
  calls = 0;
  next = status("missing");
  const { refresh } = useCliPath.getState();
  await Promise.all(Array.from({ length: 50 }, () => refresh()));
  expect(calls).toBe(1);
  expect(cliNeedsAction(useCliPath.getState().status)).toBe(true);

  useCliPath.setState({ status: null });
  next = new Error("offline");
  await refresh();
  expect(calls).toBe(2);
  expect(cliNeedsAction(useCliPath.getState().status)).toBe(false);
  expect(useCliPath.getState().error).toContain("offline");
});

test("the startup check runs once after the delay, never polls, and can be cancelled", async () => {
  calls = 0;
  next = status("ready");
  const stop = initCliPathCheck(true, 10);
  expect(calls).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(calls).toBe(1);
  expect(useCliPath.getState().status?.state).toBe("ready");
  stop();

  const cancelled = initCliPathCheck(true, 10);
  cancelled();
  const secondary = initCliPathCheck(false, 10);
  await new Promise((resolve) => setTimeout(resolve, 40));
  secondary();
  expect(calls).toBe(1);
});

test("installing in one window tells the other windows", () => {
  window.localStorage.removeItem("l8db.cli.path-changed");
  useCliPath.getState().apply(status("ready"));
  expect(window.localStorage.getItem("l8db.cli.path-changed")).not.toBeNull();
  expect(useCliPath.getState().status?.state).toBe("ready");
});
