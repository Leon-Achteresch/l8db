import { describe, expect, test } from "bun:test";

import type { DependencyInfo, SynonymInfo } from "../src/lib/db";
import { dependencyRoute, filterDependencies, groupDependencies } from "../src/lib/used-by";
import { resolveSynonym } from "../src/lib/synonyms";

function dep(partial: Partial<DependencyInfo>): DependencyInfo {
  return {
    owner: "public",
    name: "obj",
    object_type: "view",
    status: "gültig",
    relation: "View-Definition",
    oid: "1",
    detail: "",
    ...partial,
  };
}

function syn(partial: Partial<SynonymInfo>): SynonymInfo {
  return {
    owner: "APP",
    name: "S1",
    target_owner: "APP",
    target_name: "T1",
    target_type: "table",
    db_link: null,
    status: "VALID",
    ...partial,
  };
}

describe("used-by", () => {
  test("routet je Objekttyp", () => {
    expect(dependencyRoute(dep({ object_type: "MATERIALIZED VIEW" }))).toEqual({
      kind: "view",
      schema: "public",
      name: "obj",
    });
    expect(dependencyRoute(dep({ object_type: "routine", oid: "42" }))).toEqual({
      kind: "function",
      schema: "public",
      name: "obj",
      oid: "42",
    });
    expect(dependencyRoute(dep({ object_type: "trigger" }))).toBeNull();
  });

  test("gruppiert nach Beziehungsart", () => {
    const groups = groupDependencies([
      dep({ name: "a" }),
      dep({ name: "b", relation: "Fremdschlüssel" }),
      dep({ name: "c" }),
    ]);
    expect(groups.map((g) => g.relation)).toEqual(["View-Definition", "Fremdschlüssel"]);
    expect(groups[0]!.items).toHaveLength(2);
  });

  test("filtert über Owner, Name und Detail", () => {
    const list = [dep({ name: "orders_v" }), dep({ name: "invoices_v", detail: "Zeile 3" })];
    expect(filterDependencies(list, "invoice")).toHaveLength(1);
    expect(filterDependencies(list, "zeile 3")).toHaveLength(1);
    expect(filterDependencies(list, "")).toHaveLength(2);
  });
});

describe("synonyme", () => {
  test("löst Ketten bis zum Basisobjekt auf", () => {
    const all = [
      syn({ name: "S1", target_name: "S2", target_type: "synonym" }),
      syn({ name: "S2", target_name: "S3", target_type: "synonym" }),
      syn({ name: "S3", target_name: "BASE", target_type: "table" }),
    ];
    const res = resolveSynonym(all[0]!, all);
    expect(res.cycle).toBe(false);
    expect(res.target).toEqual({ owner: "APP", name: "BASE", type: "table" });
    expect(res.chain).toEqual(["APP.S1", "APP.S2", "APP.S3"]);
  });

  test("meldet Zirkel", () => {
    const all = [
      syn({ name: "A", target_name: "B", target_type: "synonym" }),
      syn({ name: "B", target_name: "A", target_type: "synonym" }),
    ];
    const res = resolveSynonym(all[0]!, all);
    expect(res.cycle).toBe(true);
    expect(res.target).toBeNull();
  });

  test("markiert DB-Link-Ziele als nicht auflösbar", () => {
    const res = resolveSynonym(syn({ db_link: "REMOTE.WORLD" }), []);
    expect(res.remote).toBe(true);
    expect(res.unresolved).toBe(true);
  });
});
