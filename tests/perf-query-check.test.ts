import { heapStats } from "bun:jsc";
import { beforeEach, expect, mock, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import type { SavedConnection } from "../src/lib/connections";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const requests: { command: string; sql: string }[] = [];
let failure: string | null = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    requests.push({ command, sql: String(args.sql ?? "") });
    if (command === "validate_sql" && failure) throw failure;
    return null;
  },
}));

const toasts: { level: string; text: string; description?: string }[] = [];
mock.module("sonner", () => {
  const push = (level: string) => (text: string, data?: { description?: string }) => {
    toasts.push({ level, text, description: data?.description });
    return 1;
  };
  return {
    toast: Object.assign(push("message"), {
      success: push("success"),
      warning: push("warning"),
      error: push("error"),
      info: push("info"),
      loading: push("loading"),
      dismiss: () => 1,
    }),
  };
});

const { checkSql } = await import("../src/features/query/query-view/check-sql");

const connection: SavedConnection = {
  id: "check-oracle",
  name: "Check Oracle",
  kind: "oracle",
  connectionString: "oracle://app:pw@localhost:1521/XEPDB1",
};
const environment = {
  os: platform(),
  release: release(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  ramBytes: totalmem(),
  bun: Bun.version,
};

const PROCEDURES = 1215;
const SPEC_HEAD = "CREATE OR REPLACE PACKAGE big_pkg AS";
const BODY_HEAD = "CREATE OR REPLACE PACKAGE BODY big_pkg AS";

function packageScript(preamble = "", eol = "\n"): string {
  const spec: string[] = [];
  const body: string[] = [];
  for (let index = 0; index < PROCEDURES; index++) {
    const signature = `  PROCEDURE p${index}(p_id IN INTEGER, p_name IN VARCHAR2, p_ref IN emp.ename%TYPE)`;
    spec.push(`${signature};`);
    body.push(
      `${signature} IS`,
      "    v_count INTEGER := 0;",
      "  BEGIN",
      "    SELECT COUNT(*) INTO v_count FROM emp WHERE ename = p_ref;",
      "    IF v_count > 0 THEN NULL; END IF;",
      `  END p${index};`,
      "",
    );
  }
  return (
    preamble +
    [SPEC_HEAD, ...spec, "END big_pkg;", "/", BODY_HEAD, ...body, "END big_pkg;", "/", ""].join(eol)
  );
}

const script = packageScript();
const commandFirst = packageScript("SET DEFINE OFF\n");
const validations = () => requests.filter((entry) => entry.command === "validate_sql");

function check(sql: string, cursorOffset: number, overrides: Record<string, unknown> = {}) {
  return checkSql({
    sql,
    selectedSql: "",
    cursorOffset,
    runTarget: "selection-or-statement",
    blankLines: false,
    connection,
    database: null,
    ...overrides,
  });
}

beforeEach(() => {
  requests.length = 0;
  toasts.length = 0;
  failure = null;
});

test("the generated script has the reported shape", () => {
  expect(script.split("\n").length).toBeGreaterThan(9700);
  expect(script.split("\n").filter((line) => line === "/").length).toBe(2);
});

test("check at the start of a 9,700-line package script sends the specification once and reports success", async () => {
  expect(await check(script, 0)).toEqual({ status: "ok" });
  expect(validations().length).toBe(1);
  expect(validations()[0].sql.startsWith(SPEC_HEAD)).toBe(true);
  expect(validations()[0].sql.endsWith("END big_pkg;")).toBe(true);
  expect(validations()[0].sql.includes(BODY_HEAD)).toBe(false);
  expect(toasts).toEqual([
    {
      level: "success",
      text: "Fehlerfrei geprüft — nichts wurde übernommen.",
      description: undefined,
    },
  ]);
});

test("check inside the body and with CRLF line ends still targets one unit", async () => {
  await check(script, script.indexOf("END p900;"));
  expect(validations()[0].sql.startsWith(BODY_HEAD)).toBe(true);
  requests.length = 0;
  await check(packageScript("", "\r\n"), 0);
  expect(validations()[0].sql.startsWith(SPEC_HEAD)).toBe(true);
  expect(toasts.map((entry) => entry.level)).toEqual(["success", "success"]);
});

test("check of the whole script sends specification and body in one request", async () => {
  expect(await check(script, 0, { runTarget: "all" })).toEqual({ status: "ok" });
  expect(validations().map((entry) => entry.sql)).toEqual([script]);
});

test("a cursor before the first SQL statement reports that nothing can be checked", async () => {
  for (const preamble of ["SET DEFINE OFF\n", "PROMPT big_pkg\n", "\n\n"]) {
    toasts.length = 0;
    expect(await check(packageScript(preamble), 0)).toEqual({ status: "skipped" });
    expect(toasts).toEqual([
      {
        level: "warning",
        text: "Kein prüfbares Statement an der Cursorposition.",
        description: undefined,
      },
    ]);
  }
  expect(requests.length).toBe(0);
});

test("an empty editor and a missing connection report instead of ending silently", async () => {
  expect(await check("  ", 0, { runTarget: "all" })).toEqual({ status: "skipped" });
  expect(await check(script, 0, { connection: null })).toEqual({ status: "skipped" });
  expect(toasts.map((entry) => entry.text)).toEqual([
    "Kein prüfbares Statement.",
    "Keine Verbindung.",
  ]);
  expect(requests.length).toBe(0);
});

test("a failed check reports the first error line and returns the full message", async () => {
  failure =
    "Oracle: PACKAGE BIG_PKG enthält Fehler\nZeile 12, Spalte 3: PLS-00201: Bezeichner 'EMP.ENAME' muss deklariert werden";
  const outcome = await check(script, 0);
  expect(outcome.status).toBe("error");
  if (outcome.status !== "error") throw Error("expected an error outcome");
  expect(outcome.message).toBe(failure);
  expect(script.indexOf(outcome.target)).toBe(0);
  expect(toasts).toEqual([
    {
      level: "error",
      text: "Prüfung fehlgeschlagen",
      description: "Oracle: PACKAGE BIG_PKG enthält Fehler",
    },
  ]);
  expect(validations().length).toBe(1);
});

test("check of a 9,700-line package script stays within the client latency and request budget", async () => {
  const bodyOffset = script.indexOf("END p1200;");
  const start = await measureScenario(async () => {
    requests.length = 0;
    await check(script, 0);
    if (validations().length !== 1) throw Error("expected exactly one validate request");
  }, 30);
  const body = await measureScenario(async () => {
    requests.length = 0;
    await check(script, bodyOffset);
    if (validations().length !== 1) throw Error("expected exactly one validate request");
  }, 30);
  const skipped = await measureScenario(async () => {
    requests.length = 0;
    await check(commandFirst, 0);
    if (requests.length !== 0) throw Error("expected no request");
  }, 15);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let round = 0; round < 20; round++) await check(script, bodyOffset);
  requests.length = 0;
  toasts.length = 0;
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("query-check-large-package", {
    lines: script.split("\n").length,
    characters: script.length,
    validateRequestsPerCheck: 1,
    start,
    body,
    skipped,
    retainedBytes,
    environment,
  });
  expect(start.medianMs).toBeLessThan(40);
  expect(start.p95Ms).toBeLessThan(100);
  expect(body.medianMs).toBeLessThan(40);
  expect(body.p95Ms).toBeLessThan(100);
  expect(skipped.medianMs).toBeLessThan(40);
  expect(skipped.p95Ms).toBeLessThan(100);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
