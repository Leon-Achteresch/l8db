import { describe, expect, test } from "bun:test";
import {
  buildObjectEntries,
  OBJECT_TYPE_PLURAL,
  objectEntryHint,
  objectEntryKeywords,
} from "../src/lib/object-search";

const tables = [
  { schema: "public", name: "kunde" },
  { schema: "billing", name: "kunde" },
];
const views = [{ schema: "public", name: "kunde_aktiv" }];
const functions = [
  {
    schema: "public",
    name: "kunde_saldo",
    identity_args: "p_id integer",
    return_type: "numeric",
    language: "plpgsql",
    oid: "1234",
  },
  {
    schema: "public",
    name: "kunde_saldo",
    identity_args: "p_id bigint",
    return_type: "numeric",
    language: "plpgsql",
    oid: "1235",
  },
];

describe("buildObjectEntries", () => {
  test("nimmt Objekte aus allen Schemas ohne Kürzung auf", () => {
    const entries = buildObjectEntries({ tables, views, functions });
    expect(entries).toHaveLength(5);
    expect(entries.filter((entry) => entry.name === "kunde")).toHaveLength(2);
  });

  test("hält gleichnamige Objekte über Schema und Typ auseinander", () => {
    const entries = buildObjectEntries({ tables, views, functions });
    const keys = new Set(entries.map((entry) => entry.key));
    expect(keys.size).toBe(entries.length);
    expect(keys.has("table:public.kunde")).toBe(true);
    expect(keys.has("table:billing.kunde")).toBe(true);
  });

  test("überladene Routinen bleiben über Signatur und oid unterscheidbar", () => {
    const entries = buildObjectEntries({ functions });
    expect(entries.map((entry) => entry.oid)).toEqual(["1234", "1235"]);
    expect(entries[0]?.key).not.toBe(entries[1]?.key);
  });

  test("dedupliziert identische Einträge", () => {
    const entries = buildObjectEntries({ tables: [...tables, ...tables] });
    expect(entries).toHaveLength(2);
  });

  test("liefert leere Liste ohne Daten", () => {
    expect(buildObjectEntries({})).toEqual([]);
  });
});

describe("Anzeige", () => {
  test("Hinweis nennt Typ und Schema", () => {
    const [entry] = buildObjectEntries({ tables });
    expect(objectEntryHint(entry!)).toBe("Tabelle · public");
  });

  test("Routine-Hinweis enthält Signatur", () => {
    const [entry] = buildObjectEntries({ functions });
    expect(objectEntryHint(entry!)).toBe("Routine · public(p_id integer)");
  });

  test("Stichwörter enthalten qualifizierten Namen", () => {
    const [entry] = buildObjectEntries({ tables });
    expect(objectEntryKeywords(entry!)).toContain("public.kunde");
  });

  test("Gruppenbezeichnungen sind gesetzt", () => {
    expect(OBJECT_TYPE_PLURAL.view).toBe("Views");
  });
});
