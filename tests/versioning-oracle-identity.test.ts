import { expect, test } from "bun:test";
import { buildCompareApplyPlan } from "../src/lib/compare-apply-plan";
import { EMPTY_COMPARE_SIDE } from "../src/lib/compare-types";
import type { DetailedColumnInfo } from "../src/lib/db";
import {
  oracleIdentityDefault,
  portableOracleIdentityColumns,
  portableOracleMetadata,
} from "../src/lib/versioning/oracle-metadata";

const column: DetailedColumnInfo = {
  name: "ID",
  data_type: "NUMBER",
  is_nullable: false,
  column_default: '"DEV"."ISEQ$$_123".nextval',
  is_primary_key: true,
  ordinal_position: 1,
  character_maximum_length: null,
};
const identity = {
  column: "ID",
  generation: "BY DEFAULT",
  sequence: "ISEQ$$_123",
  options: "START WITH: 1, INCREMENT BY: 1, CACHE_SIZE: 20",
  onNull: "NO",
};

test("Oracle identity snapshots are portable while generation and sequence options remain observable", () => {
  const expected = "IDENTITY BY DEFAULT (CACHE_SIZE: 20, INCREMENT BY: 1, START WITH: 1)";
  expect(oracleIdentityDefault(identity)).toBe(expected);
  expect(
    oracleIdentityDefault({
      ...identity,
      sequence: "ISEQ$$_987",
      options: " CACHE_SIZE: 20, START WITH: 1, INCREMENT BY: 1 ",
    }),
  ).toBe(expected);
  for (const changed of [
    { generation: "ALWAYS" },
    { onNull: "YES" },
    { options: identity.options.replace("20", "40") },
  ])
    expect(oracleIdentityDefault({ ...identity, ...changed })).not.toBe(expected);
  const ordinary = { ...column, name: "OTHER", column_default: "app_sequence.nextval" };
  expect(portableOracleIdentityColumns([column, ordinary], [identity])).toEqual([
    { ...column, column_default: expected },
    ordinary,
  ]);
  for (const invalid of [
    { options: "" },
    { options: "CACHE_SIZE: 20, CACHE_SIZE: 40" },
    { options: "CACHE_SIZE: 20: 40" },
    { generation: "UNKNOWN" },
    { onNull: undefined },
  ])
    expect(() => oracleIdentityDefault({ ...identity, ...invalid })).toThrow("Identity");
  expect(() => portableOracleIdentityColumns([column], [identity, identity])).toThrow("eindeutig");
});

test("Oracle v3 omits only redundant generated not-null metadata and retains v2 snapshots", async () => {
  const constraint = {
    name: "SYS_C001",
    constraint_type: "CHECK",
    columns: ["ID"],
    definition: 'CHECK ("ID" IS NOT NULL)',
  };
  const row = {
    name: "SYS_C001",
    generated: "GENERATED NAME",
    status: "ENABLED",
    validated: "VALIDATED",
    deferrable: "NOT DEFERRABLE",
    deferred: "IMMEDIATE",
  };
  const capture = (metadata = row, col = column, item = constraint, v3 = true) =>
    portableOracleMetadata([item], [], [metadata], "DEV", "DEV", v3 ? [col] : undefined);
  expect((await capture()).constraints).toHaveLength(0);
  expect((await capture(row, column, constraint, false)).constraints).toHaveLength(1);
  for (const changed of [
    { generated: "USER NAME" },
    { status: "DISABLED" },
    { validated: "NOT VALIDATED" },
    { deferrable: "DEFERRABLE" },
    { deferred: "DEFERRED" },
  ])
    expect((await capture({ ...row, ...changed })).constraints).toHaveLength(1);
  expect((await capture(row, { ...column, is_nullable: true })).constraints).toHaveLength(1);
  expect(
    (await capture(row, column, { ...constraint, definition: 'CHECK ("ID" > 0)' })).constraints,
  ).toHaveLength(1);
});

test("Oracle column migrations retain identities and block unsupported identity modifications", () => {
  const side = { ...EMPTY_COMPARE_SIDE, schema: "DEV", objectName: "CUSTOMERS" };
  const marker = oracleIdentityDefault(identity);
  const before = `TABLE DEV.CUSTOMERS\nCOLUMNS\n  ID NUMBER NOT NULL DEFAULT ${marker} PRIMARY KEY`;
  const after = `${before}\n  ACTIVE NUMBER(1) NOT NULL DEFAULT 1`;
  expect(buildCompareApplyPlan("oracle", side, before, after)).toEqual([
    'ALTER TABLE "DEV"."CUSTOMERS" ADD ("ACTIVE" NUMBER(1) DEFAULT 1 NOT NULL)',
  ]);
  expect(() =>
    buildCompareApplyPlan("oracle", side, before, before.replace("BY DEFAULT", "ALWAYS")),
  ).toThrow("Identitätsspalten");
  expect(() =>
    buildCompareApplyPlan(
      "oracle",
      side,
      before,
      `${before}\n  NEXT_ID NUMBER NOT NULL DEFAULT ${marker}`,
    ),
  ).toThrow("Identitätsspalten");
});
