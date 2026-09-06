import { describe, expect, test } from "bun:test";
import {
  buildParameterizedQuery,
  detectBindParams,
  normalizeBindValue,
  pgCastFor,
  validateBindParams,
} from "../src/lib/bind-params";

describe("detectBindParams", () => {
  test("erkennt positionale Platzhalter in Reihenfolge", () => {
    const refs = detectBindParams("SELECT * FROM t WHERE b = $2 AND a = $1");
    expect(refs.map((r) => r.label)).toEqual(["$1", "$2"]);
  });

  test("erkennt benannte Platzhalter einmalig", () => {
    const refs = detectBindParams("SELECT :name, :age, :name");
    expect(refs.map((r) => r.label)).toEqual([":name", ":age"]);
  });

  test("ignoriert Casts", () => {
    expect(detectBindParams("SELECT id::text FROM t")).toEqual([]);
    expect(detectBindParams("SELECT $1::int FROM t").map((r) => r.label)).toEqual(["$1"]);
  });

  test("ignoriert Strings und Kommentare", () => {
    const sql = "SELECT ':nope', '$1' -- :comment\n/* :block $2 */ , :real";
    expect(detectBindParams(sql).map((r) => r.label)).toEqual([":real"]);
  });

  test("ignoriert Dollar-Quoting", () => {
    const sql = "CREATE FUNCTION f() RETURNS int AS $$ SELECT $1 + 1 $$ LANGUAGE sql";
    expect(detectBindParams(sql)).toEqual([]);
  });

  test("ignoriert benannte Dollar-Tags", () => {
    const sql = "DO $body$ BEGIN PERFORM :x; END $body$";
    expect(detectBindParams(sql)).toEqual([]);
  });

  test("ignoriert doppelt gequotete Bezeichner", () => {
    expect(detectBindParams('SELECT "a:b" FROM t')).toEqual([]);
  });

  test("ignoriert Escape-Strings mit Backslash", () => {
    expect(detectBindParams("SELECT E'\\':x' , :y").map((r) => r.label)).toEqual([":y"]);
  });

  test("ignoriert := Zuweisungen", () => {
    expect(detectBindParams("CALL p(a := 1)")).toEqual([]);
  });
});

describe("validateBindParams", () => {
  const refs = detectBindParams("SELECT $1, $2");

  test("meldet fehlende Werte", () => {
    expect(validateBindParams(refs, {})).toEqual(["$1: Wert fehlt.", "$2: Wert fehlt."]);
  });

  test("meldet ungültige Ganzzahl", () => {
    const errors = validateBindParams(refs, {
      "1": { type: "int", value: "abc" },
      "2": { type: "text", value: "ok" },
    });
    expect(errors).toEqual(["$1: Keine gültige Ganzzahl."]);
  });

  test("meldet ungültige Dezimalzahl und Boolean", () => {
    const errors = validateBindParams(refs, {
      "1": { type: "numeric", value: "1,5" },
      "2": { type: "bool", value: "vielleicht" },
    });
    expect(errors).toEqual([
      "$1: Keine gültige Dezimalzahl.",
      "$2: Nur true oder false erlaubt.",
    ]);
  });

  test("akzeptiert NULL ohne Wert", () => {
    expect(
      validateBindParams(refs, {
        "1": { type: "null", value: "" },
        "2": { type: "timestamp", value: "2024-01-01T10:00:00Z" },
      }),
    ).toEqual([]);
  });

  test("meldet Lücken in der Nummerierung", () => {
    const gap = detectBindParams("SELECT $2");
    const errors = validateBindParams(gap, { "2": { type: "text", value: "x" } });
    expect(errors).toContain("Platzhalter $1 fehlt.");
  });
});

describe("buildParameterizedQuery", () => {
  test("setzt Casts und Werte in Reihenfolge", () => {
    const result = buildParameterizedQuery("SELECT * FROM t WHERE b = $2 AND a = $1", {
      "1": { type: "int", value: " 7 " },
      "2": { type: "text", value: "foo" },
    });
    expect(result.sql).toBe("SELECT * FROM t WHERE b = $2::text AND a = $1::bigint");
    expect(result.values).toEqual(["7", "foo"]);
  });

  test("mappt benannte Parameter auf Positionen", () => {
    const result = buildParameterizedQuery("SELECT :name, :age, :name", {
      name: { type: "text", value: "ada" },
      age: { type: "int", value: "36" },
    });
    expect(result.sql).toBe("SELECT $1::text, $2::bigint, $1::text");
    expect(result.values).toEqual(["ada", "36"]);
  });

  test("mischt positionale und benannte Parameter", () => {
    const result = buildParameterizedQuery("SELECT $1, :flag", {
      "1": { type: "text", value: "a" },
      flag: { type: "bool", value: "T" },
    });
    expect(result.sql).toBe("SELECT $1::text, $2::boolean");
    expect(result.values).toEqual(["a", "true"]);
  });

  test("bindet NULL als null-Wert", () => {
    const result = buildParameterizedQuery("SELECT $1", { "1": { type: "null", value: "" } });
    expect(result.values).toEqual([null]);
    expect(result.sql).toBe("SELECT $1::text");
  });

  test("lässt Strings und Kommentare unverändert", () => {
    const sql = "SELECT '$1', :x -- $2\n";
    const result = buildParameterizedQuery(sql, { x: { type: "text", value: "v" } });
    expect(result.sql).toBe("SELECT '$1', $1::text -- $2\n");
    expect(result.values).toEqual(["v"]);
  });
});

describe("Hilfsfunktionen", () => {
  test("pgCastFor liefert Zieltypen", () => {
    expect(pgCastFor("timestamp")).toBe("timestamptz");
    expect(pgCastFor("null")).toBe("text");
  });

  test("normalizeBindValue normalisiert Boolean", () => {
    expect(normalizeBindValue({ type: "bool", value: "Yes" })).toBe("true");
    expect(normalizeBindValue({ type: "bool", value: "n" })).toBe("false");
  });
});
