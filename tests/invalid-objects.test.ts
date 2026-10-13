import { expect, test } from "bun:test";

import type { InvalidObjectInfo } from "../src/lib/db";
import {
  buildInvalidProblems,
  buildInvalidSet,
  compileArgForInvalidType,
  filterInvalidByTypes,
  filterInvalidProblems,
  INVALID_GROUP_TYPES,
  invalidTypeLabel,
  invalidTypeLabels,
  isFunctionInvalid,
  isPackageInvalid,
  isPackagePartInvalid,
  isProcedureInvalid,
  isSynonymTargetInvalid,
  isTriggerInvalid,
  isViewInvalid,
  parseCompileMessage,
} from "../src/lib/invalid-objects";

function item(schema: string, name: string, object_type: string): InvalidObjectInfo {
  return {
    schema,
    name,
    object_type,
    status: "INVALID",
    oid: `${schema}\u{1f}${name}\u{1f}${object_type}`,
  };
}

const sample = [
  item("HR", "CALC", "FUNCTION"),
  item("HR", "RUN_JOB", "PROCEDURE"),
  item("HR", "PKG", "PACKAGE"),
  item("HR", "PKG", "PACKAGE BODY"),
  item("HR", "V_EMP", "VIEW"),
  item("HR", "TRG_AUDIT", "TRIGGER"),
];

test("buildInvalidSet matches case-insensitively per object type", () => {
  const set = buildInvalidSet(sample);
  expect(isFunctionInvalid(set, "hr", "calc")).toBe(true);
  expect(isFunctionInvalid(set, "HR", "RUN_JOB")).toBe(false);
  expect(isProcedureInvalid(set, "HR", "RUN_JOB")).toBe(true);
  expect(isPackageInvalid(set, "HR", "PKG")).toBe(true);
  expect(isPackagePartInvalid(set, "HR", "PKG", "spec")).toBe(true);
  expect(isPackagePartInvalid(set, "HR", "PKG", "body")).toBe(true);
  expect(isViewInvalid(set, "HR", "V_EMP")).toBe(true);
  expect(isTriggerInvalid(set, "HR", "TRG_AUDIT")).toBe(true);
  expect(isViewInvalid(set, "HR", "CALC")).toBe(false);
});

test("buildInvalidSet handles undefined as empty", () => {
  const set = buildInvalidSet(undefined);
  expect(isFunctionInvalid(set, "HR", "CALC")).toBe(false);
});

test("filterInvalidByTypes selects only the requested group", () => {
  expect(filterInvalidByTypes(sample, INVALID_GROUP_TYPES.functions).map((i) => i.name)).toEqual([
    "CALC",
  ]);
  expect(filterInvalidByTypes(sample, INVALID_GROUP_TYPES.procedures).map((i) => i.name)).toEqual([
    "RUN_JOB",
  ]);
  expect(filterInvalidByTypes(sample, INVALID_GROUP_TYPES.packages)).toHaveLength(2);
  expect(filterInvalidByTypes(sample, INVALID_GROUP_TYPES.views).map((i) => i.name)).toEqual([
    "V_EMP",
  ]);
  expect(filterInvalidByTypes(undefined, INVALID_GROUP_TYPES.views)).toEqual([]);
});

test("compileArgForInvalidType maps Oracle types to compile args", () => {
  expect(compileArgForInvalidType("PACKAGE")).toBe("package_spec");
  expect(compileArgForInvalidType("PACKAGE BODY")).toBe("package_body");
  expect(compileArgForInvalidType("function")).toBe("function");
  expect(compileArgForInvalidType("PROCEDURE")).toBe("procedure");
  expect(compileArgForInvalidType("TRIGGER")).toBe("trigger");
  expect(compileArgForInvalidType("VIEW")).toBe("view");
  expect(compileArgForInvalidType("MATERIALIZED VIEW")).toBe("view");
  expect(compileArgForInvalidType("TYPE BODY")).toBe("type_body");
});

test("isSynonymTargetInvalid treats only VALID as healthy", () => {
  expect(isSynonymTargetInvalid("VALID")).toBe(false);
  expect(isSynonymTargetInvalid("valid")).toBe(false);
  expect(isSynonymTargetInvalid("INVALID")).toBe(true);
  expect(isSynonymTargetInvalid("UNKNOWN")).toBe(true);
});

test("buildInvalidProblems attaches compile errors to their object case-insensitively", () => {
  const errors = [
    { schema: "hr", name: "pkg", object_type: "package body", line: 3, position: 1, message: "x" },
    { schema: "HR", name: "PKG", object_type: "PACKAGE", line: 1, position: 1, message: "y" },
    { schema: "HR", name: "OTHER", object_type: "VIEW", line: 0, position: 0, message: "z" },
  ];
  const { problems, others, matched } = buildInvalidProblems(sample, errors);
  expect(problems).toHaveLength(sample.length);
  expect(others).toEqual([errors[2]]);
  expect(matched).toBe(2);
  expect(problems.find((p) => p.item.object_type === "PACKAGE BODY")?.errors).toEqual([errors[0]]);
  expect(problems.find((p) => p.item.object_type === "PACKAGE")?.errors).toEqual([errors[1]]);
  expect(problems.find((p) => p.item.name === "V_EMP")?.errors).toEqual([]);
});

test("filterInvalidProblems combines type label and schema-qualified search", () => {
  const { problems } = buildInvalidProblems(sample, []);
  expect(filterInvalidProblems(problems, null, "  ")).toBe(problems);
  expect(filterInvalidProblems(problems, "Package", "").map((p) => p.item.object_type)).toEqual([
    "PACKAGE",
  ]);
  expect(filterInvalidProblems(problems, null, "hr.pk").map((p) => p.item.object_type)).toEqual([
    "PACKAGE",
    "PACKAGE BODY",
  ]);
  expect(filterInvalidProblems(problems, "View", "calc")).toEqual([]);
  expect(invalidTypeLabels(sample)).toEqual([
    "Funktion",
    "Prozedur",
    "Package",
    "Package Body",
    "View",
    "Trigger",
  ]);
});

test("parseCompileMessage splits Oracle error codes from the message", () => {
  expect(parseCompileMessage("PLS-00201: identifier 'X' must be declared")).toEqual({
    code: "PLS-00201",
    text: "identifier 'X' must be declared",
  });
  expect(parseCompileMessage("PL/SQL: SQL Statement ignored")).toEqual({
    code: null,
    text: "PL/SQL: SQL Statement ignored",
  });
  expect(invalidTypeLabel("materialized view")).toBe("Mat. View");
  expect(invalidTypeLabel("JAVA CLASS")).toBe("JAVA CLASS");
});
