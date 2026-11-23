import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { QueryResult } from "../src/lib/db/types";
import { buildProcedureCall, parseProcedureParams } from "../src/lib/procedure-params";
import { createProcedureRun } from "../src/lib/procedure-run";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let respond: () => Promise<QueryResult>;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    return respond();
  },
}));
const { executeQuery } = await import("../src/lib/db/rows");

const result: QueryResult = {
  columns: ["answer", "empty", "total"],
  rows: [{ answer: null, empty: "", total: "9007199254740993.50" }],
  rows_affected: null,
  execution_time_ms: 7,
  truncated: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  calls.length = 0;
  respond = async () => result;
});

describe("existing procedure result transport", () => {
  test("one explicit existing CALL keeps the entire returned result by reference", async () => {
    const run = createProcedureRun();
    const scope = {};
    run.setScope(scope);
    const sql = buildProcedureCall(
      "postgres",
      "public",
      "do_it",
      parseProcedureParams("IN a integer, OUT total numeric"),
      { a: "7" },
    );
    expect(
      await run.run(scope, () =>
        executeQuery("postgres", "postgresql://fixture.invalid/db", sql, "db"),
      ),
    ).toBe(true);
    const queries = calls.filter((call) => call.command === "execute_query");
    expect(queries).toHaveLength(1);
    expect(calls.filter((call) => call.command.startsWith("execute_"))).toHaveLength(1);
    expect(queries[0].args.sql).toBe('CALL "public"."do_it"(7, NULL)');
    expect(queries[0].args.database).toBe("db");
    const state = run.getSnapshot().state;
    expect(state.status).toBe("success");
    if (state.status !== "success") throw Error("missing result");
    expect(state.result).toBe(result);
    expect(state.result.rows[0]).toEqual({ answer: null, empty: "", total: "9007199254740993.50" });
  });

  test("an empty rowset, no rowset, affected rows and declared truncation remain intact", async () => {
    const run = createProcedureRun();
    const scope = {};
    run.setScope(scope);
    for (const value of [
      { ...result, rows: [] },
      { ...result, columns: [], rows: [], rows_affected: 4, notice: "Fertig" },
      { ...result, truncated: true },
    ]) {
      await run.run(scope, async () => value);
      const state = run.getSnapshot().state;
      if (state.status !== "success") throw Error("missing result");
      expect(state.result).toBe(value);
    }
  });

  test("a repeat immediately drops old rows and a failure cannot retain old success", async () => {
    const run = createProcedureRun();
    const scope = {};
    run.setScope(scope);
    await run.run(scope, async () => result);
    const next = deferred<QueryResult>();
    const pending = run.run(scope, () => next.promise);
    expect(run.getSnapshot()).toEqual({ scope, pending: true, state: { status: "loading" } });
    next.reject(new Error("Ausführung fehlgeschlagen"));
    await pending;
    expect(run.getSnapshot()).toEqual({
      scope,
      pending: false,
      state: { status: "error", message: "Error: Ausführung fehlgeschlagen" },
    });
    await run.run(scope, async () => result);
    expect(run.getSnapshot().state.status).toBe("success");
  });

  test("rapid repeats and a stale or absent scope cannot dispatch another call", async () => {
    const run = createProcedureRun();
    const scope = {};
    const next = deferred<QueryResult>();
    let requests = 0;
    const execute = () => {
      requests++;
      return next.promise;
    };
    expect(await run.run(null, execute)).toBe(false);
    run.setScope(scope);
    expect(await run.run({}, execute)).toBe(false);
    const pending = run.run(scope, execute);
    expect(await run.run(scope, execute)).toBe(false);
    expect(requests).toBe(1);
    next.resolve(result);
    await pending;
  });

  for (const change of [
    "close/reopen",
    "connection",
    "database",
    "routine",
    "signature",
    "parameters",
  ]) {
    test(`${change} hides the previous result and ignores a late success or error`, async () => {
      for (const fail of [false, true]) {
        const run = createProcedureRun();
        const old = {};
        const current = {};
        const next = deferred<QueryResult>();
        run.setScope(old);
        const pending = run.run(old, () => next.promise);
        run.setScope(null);
        run.setScope(current);
        expect(run.getSnapshot()).toEqual({
          scope: current,
          pending: true,
          state: { status: "idle" },
        });
        let unexpected = 0;
        expect(
          await run.run(current, async () => {
            unexpected++;
            return result;
          }),
        ).toBe(false);
        if (fail) next.reject(new Error("late error"));
        else next.resolve(result);
        await pending;
        expect(unexpected).toBe(0);
        expect(run.getSnapshot()).toEqual({
          scope: current,
          pending: false,
          state: { status: "idle" },
        });
        await run.run(current, async () => result);
        run.setScope({});
        expect(run.getSnapshot().state).toEqual({ status: "idle" });
      }
    });
  }

  test("synchronous connection failure is caught without retry or a direct fallback", async () => {
    const run = createProcedureRun();
    const scope = {};
    run.setScope(scope);
    await run.run(scope, () => {
      throw new Error("Tunnel nicht aktiv");
    });
    expect(run.getSnapshot().state).toEqual({
      status: "error",
      message: "Error: Tunnel nicht aktiv",
    });
    expect(calls).toHaveLength(0);
  });

  test("returning to the same context cannot revive an abandoned response and repeat IDs change", async () => {
    const run = createProcedureRun();
    const scope = {};
    run.setScope(scope);
    const next = deferred<QueryResult>();
    const pending = run.run(scope, () => next.promise);
    run.setScope(null);
    run.setScope(scope);
    next.resolve(result);
    await pending;
    expect(run.getSnapshot().state.status).toBe("idle");
    await run.run(scope, async () => result);
    const first = run.getSnapshot().state;
    await run.run(scope, async () => result);
    const second = run.getSnapshot().state;
    if (first.status !== "success" || second.status !== "success") throw Error("missing results");
    expect(second.runId).not.toBe(first.runId);
  });

  test("closing releases the held result; unsubscribed consumers receive no late notifications", async () => {
    const run = createProcedureRun();
    const scope = {};
    run.setScope(scope);
    let notifications = 0;
    const stop = run.subscribe(() => notifications++);
    await run.run(scope, async () => result);
    expect(notifications).toBe(2);
    run.setScope(null);
    expect(run.getSnapshot().state).toEqual({ status: "idle" });
    const before = notifications;
    stop();
    run.setScope({});
    expect(notifications).toBe(before);
  });
});
