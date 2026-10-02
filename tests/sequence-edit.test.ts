import { describe, expect, test } from "bun:test";
import {
  canEditSequences,
  sequenceChanges,
} from "../src/features/sequences/sequences-view/sequence-changes";
import type { DatabaseKind, SequenceInfo } from "../src/lib/db";

const sequence: SequenceInfo = {
  schema: "public",
  name: "s",
  data_type: "bigint",
  start_value: "1",
  min_value: "1",
  max_value: "9223372036854775807",
  increment_by: "1",
  cycle: false,
  last_value: null,
};

const form = {
  increment_by: sequence.increment_by,
  min_value: sequence.min_value,
  max_value: sequence.max_value,
  cycle: sequence.cycle,
  restart_with: "",
};

describe("sequence edit", () => {
  test("only adapters that implement alter_sequence offer editing", () => {
    expect(canEditSequences("postgres")).toBe(true);
    for (const kind of ["mssql", "oracle", "mysql", "duckdb"] as DatabaseKind[])
      expect(canEditSequences(kind)).toBe(false);
    expect(canEditSequences(undefined)).toBe(false);
  });

  test("sends only changed values", () => {
    expect(sequenceChanges(sequence, form)).toEqual({});
    expect(
      sequenceChanges(sequence, {
        ...form,
        increment_by: " 5 ",
        max_value: "",
        cycle: true,
        restart_with: "-10",
      }),
    ).toEqual({ increment_by: "5", max_value: "", cycle: true, restart_with: "-10" });
  });

  test("rejects values that are not whole numbers before they reach the DDL", () => {
    for (const bad of ["1; DROP TABLE users", "1.5", "abc", "1e3", ""])
      expect(() => sequenceChanges(sequence, { ...form, increment_by: bad })).toThrow("ganze Zahl");
    expect(() => sequenceChanges(sequence, { ...form, min_value: "0 OWNED BY NONE" })).toThrow(
      "ganze Zahl",
    );
    expect(() => sequenceChanges(sequence, { ...form, max_value: "--" })).toThrow("ganze Zahl");
    expect(() => sequenceChanges(sequence, { ...form, restart_with: "1 CACHE 5" })).toThrow(
      "ganze Zahl",
    );
  });
});
