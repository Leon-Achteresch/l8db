import { describe, expect, test } from "bun:test";
import { triggerStatus } from "../src/features/triggers/trigger-status";

describe("triggerStatus", () => {
  test("SQL Server, Oracle, MySQL and SQLite single-letter codes", () => {
    expect(triggerStatus("D")).toEqual({ label: "DISABLED", disabled: true });
    expect(triggerStatus("O")).toEqual({ label: "ENABLED", disabled: false });
  });

  test("Postgres tgenabled labels", () => {
    expect(triggerStatus("DISABLED")).toEqual({ label: "DISABLED", disabled: true });
    expect(triggerStatus("ORIGIN")).toEqual({ label: "ORIGIN", disabled: false });
    expect(triggerStatus("REPLICA")).toEqual({ label: "REPLICA", disabled: false });
    expect(triggerStatus("ALWAYS")).toEqual({ label: "ALWAYS", disabled: false });
    expect(triggerStatus("ENABLED")).toEqual({ label: "ENABLED", disabled: false });
  });
});
