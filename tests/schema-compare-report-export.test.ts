import { expect, test } from "bun:test";
import {
  exportSchemaReport,
  type ReportExportIo,
  schemaReportIssue,
} from "../src/lib/schema-compare/report-export";
import { reportResult, reportState } from "./fixtures/schema-report";

const script = { statements: [], warnings: [] };
function io() {
  const calls: string[] = [];
  const bridge: ReportExportIo = {
    choosePath: async (name) => {
      calls.push(name);
      return "/chosen/report.md";
    },
    copy: async (text) => {
      calls.push(`copy:${text.slice(0, 24)}`);
    },
    write: async (path, text) => {
      calls.push(`write:${path}:${text.slice(0, 24)}`);
    },
  };
  return { calls, bridge };
}

test("freshness covers source, target, types, options, old results, loading and failed reruns", () => {
  const result = reportResult();
  const state = reportState(result);
  expect(schemaReportIssue(state)).toBeNull();
  expect(schemaReportIssue({ ...state, result: null })).toContain("Zuerst");
  expect(schemaReportIssue({ ...state, loading: "reading" })).toContain("läuft");
  expect(schemaReportIssue({ ...state, error: "failed" })).toContain("fehlgeschlagen");
  expect(schemaReportIssue({ ...state, source: { ...state.source, schema: "other" } })).toContain(
    "veraltet",
  );
  expect(schemaReportIssue({ ...state, target: { ...state.target, database: "other" } })).toContain(
    "veraltet",
  );
  expect(schemaReportIssue({ ...state, types: ["index"] })).toContain("veraltet");
  expect(
    schemaReportIssue({ ...state, options: { ...state.options, ignoreComments: true } }),
  ).toContain("veraltet");
  expect(
    schemaReportIssue({ ...state, result: { ...result, requestedTypes: undefined } }),
  ).toContain("Älterer");
  result.requestedTypes = ["table", "index"];
  state.types = ["table", "index", "package"];
  expect(schemaReportIssue(state)).toBeNull();
  result.types = [];
  expect(schemaReportIssue(state)).toContain("Kein geprüfter Objekttyp");
});

test("copy and save use existing IO only after an explicit action; cancellation writes nothing", async () => {
  const state = reportState();
  const { calls, bridge } = io();
  expect(calls).toEqual([]);
  expect(await exportSchemaReport("copy", state, () => state, script, bridge)).toBe("copied");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toStartWith("copy:# Schemaänderungsbericht");
  calls.length = 0;
  expect(await exportSchemaReport("save", state, () => state, script, bridge)).toBe("saved");
  expect(calls).toHaveLength(2);
  calls.length = 0;
  bridge.choosePath = async () => null;
  expect(await exportSchemaReport("save", state, () => state, script, bridge)).toBe("cancelled");
  expect(calls).toEqual([]);
});

test("changes or failures during the save dialog never write an obsolete report", async () => {
  const initial = reportState();
  let current = initial;
  const { calls, bridge } = io();
  for (const patch of [
    { result: reportResult() },
    { selection: { changed: true } },
    { renames: { a: "b" } },
    { loading: "reading" },
    { error: "failed" },
    { options: { ...initial.options, diffLimit: 1 } },
  ]) {
    current = initial;
    bridge.choosePath = async () => {
      current = { ...initial, ...patch };
      return "/chosen/report.md";
    };
    await expect(
      exportSchemaReport("save", initial, () => current, script, bridge),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  }
});

test("IO errors propagate without a false success", async () => {
  const state = reportState();
  const { bridge } = io();
  bridge.copy = async () => {
    throw new Error("clipboard unavailable");
  };
  await expect(exportSchemaReport("copy", state, () => state, script, bridge)).rejects.toThrow(
    "clipboard unavailable",
  );
  bridge.write = async () => {
    throw new Error("disk unavailable");
  };
  await expect(exportSchemaReport("save", state, () => state, script, bridge)).rejects.toThrow(
    "disk unavailable",
  );
});
