import { describe, expect, test } from "bun:test";

import type { DatabaseKind } from "../src/lib/db";
import { canonical } from "../src/lib/schema-compare/diff";
import { DEFAULT_COMPARE_OPTIONS } from "../src/lib/schema-compare/types";

const both = { ...DEFAULT_COMPARE_OPTIONS, ignoreWhitespace: true, ignoreCase: true };

function same(kind: DatabaseKind, a: string, b: string, options = both): boolean {
  return canonical(a, "app", kind, options) === canonical(b, "app", kind, options);
}

describe("canonical lässt Zeichenkettenliterale unverändert", () => {
  const cases: [DatabaseKind, string, string][] = [
    ["postgres", "DEFAULT 'A  B'::text", "DEFAULT 'a b'::text"],
    [
      "postgres",
      "CHECK ((status = ANY (ARRAY['Open'::text, 'Closed'::text])))",
      "CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))",
    ],
    ["postgres", "DEFAULT E'line\\\\n  x'", "DEFAULT E'line\\\\n x'"],
    ["sqlite", "CHECK (kind IN ('A', 'B'))", "CHECK (kind IN ('a', 'b'))"],
    ["oracle", "DEFAULT q'[It''s  Open]'", "DEFAULT q'[it''s open]'"],
    ["oracle", "CHECK (status IN ('OPEN','CLOSED'))", "CHECK (status IN ('open','closed'))"],
    ["mysql", "DEFAULT 'it\\'s  Open'", "DEFAULT 'it\\'s open'"],
    ["mysql", 'DEFAULT "Open  Now"', 'DEFAULT "open now"'],
    ["mssql", "DEFAULT (N'Open  Now')", "DEFAULT (N'open now')"],
    ["mssql", "CHECK ([status]='Open')", "CHECK ([status]='open')"],
  ];
  for (const [kind, a, b] of cases)
    test(`${kind}: ${a}`, () => {
      expect(same(kind, a, b)).toBe(false);
      expect(same(kind, a, b, { ...both, ignoreCase: false })).toBe(false);
    });

  test("Leerraum in Literalen bleibt auch ohne ignoreCase erhalten", () => {
    const options = { ...DEFAULT_COMPARE_OPTIONS };
    expect(same("postgres", "DEFAULT 'a  b'", "DEFAULT 'a b'", options)).toBe(false);
    expect(same("mysql", "DEFAULT 'a\\'  b'", "DEFAULT 'a\\' b'", options)).toBe(false);
  });
});

describe("canonical ignoriert weiterhin Formatierung außerhalb von Literalen", () => {
  test("Leerraum und Schreibweise im Code", () => {
    expect(same("postgres", "CHECK ((status  =\n  'Open'))", "check ((STATUS = 'Open'))")).toBe(
      true,
    );
    expect(
      same(
        "mysql",
        "CREATE  VIEW `v` AS\nSELECT 'x' -- Kommentar",
        "create view `v` as select 'x' -- kommentar",
      ),
    ).toBe(true);
    expect(
      same(
        "mssql",
        "CREATE VIEW [app].[v]\nAS SELECT N'x'",
        "create view [app].[v] as select N'x'",
      ),
    ).toBe(true);
    expect(
      same(
        "oracle",
        "CREATE VIEW \"V\"\n  AS SELECT 'x' FROM dual",
        "create view \"V\" as select 'x' from DUAL",
      ),
    ).toBe(true);
  });

  test("ohne ignoreCase bleibt die Schreibweise im Code relevant", () => {
    const options = { ...DEFAULT_COMPARE_OPTIONS, ignoreCase: false };
    expect(same("postgres", "SELECT a", "select a", options)).toBe(false);
    expect(same("postgres", "SELECT  a", "SELECT a", options)).toBe(true);
  });
});
