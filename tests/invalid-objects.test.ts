import { expect, test } from "bun:test";

import type { InvalidObjectInfo } from "../src/lib/db";
import {
  buildInvalidSet,
  compileArgForInvalidType,
  filterInvalidByTypes,
  INVALID_GROUP_TYPES,
  isFunctionInvalid,
  isPackageInvalid,
  isPackagePartInvalid,
  isProcedureInvalid,
  isSynonymTargetInvalid,
  isTriggerInvalid,
  isViewInvalid,
} from "../src/lib/invalid-objects";

function item(schema: string, name: string, object_type: string): InvalidObjectInfo {
  return { schema, name, object_type, status: "INVALID", oid: `${schema}\u{1f}${name}\u{1f}${object_type}` };
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
