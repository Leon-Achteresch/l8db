import { describe, expect, it } from "bun:test";
import {
  activeFilterCount,
  applyResultView,
  compareResultValues,
  describeResultCount,
  detectColumnKind,
  detectColumnKinds,
  filterResultRows,
  isFilterActive,
  matchesResultFilter,
  type ResultFilters,
  type ResultRow,
  resultFilterOperatorLabel,
  sortDirectionFor,
  sortRankFor,
  sortResultRows,
  toggleResultSort,
} from "../src/lib/result-grid";

const rows: ResultRow[] = [
  { id: "10", name: "Bravo", created: "2024-02-01", note: null },
  { id: "2", name: "alpha", created: "2023-12-31T10:00:00Z", note: "hallo" },
  { id: "33", name: null, created: null, note: "Welt" },
  { id: "2", name: "Charlie", created: "2024-02-01", note: "hallo welt" },
];
const columns = ["id", "name", "created", "note"];

describe("detectColumnKind", () => {
  it("erkennt Zahlen, Datum und Text", () => {
    expect(detectColumnKind(rows, "id")).toBe("number");
    expect(detectColumnKind(rows, "created")).toBe("date");
    expect(detectColumnKind(rows, "name")).toBe("text");
  });

  it("fällt bei leeren Spalten auf Text zurück", () => {
    expect(detectColumnKind([{ a: null }, { a: null }], "a")).toBe("text");
    expect(detectColumnKinds(rows, columns).note).toBe("text");
  });
});

describe("compareResultValues", () => {
  it("sortiert Zahlen numerisch statt lexikografisch", () => {
    expect(compareResultValues("10", "9", "number")).toBeGreaterThan(0);
    expect(compareResultValues("10", "9", "text")).toBeLessThan(0);
  });

  it("sortiert Datumswerte chronologisch", () => {
    expect(compareResultValues("2023-12-31T10:00:00Z", "2024-02-01", "date")).toBeLessThan(0);
  });

  it("stellt NULL in beiden Richtungen ans Ende", () => {
    expect(compareResultValues(null, "a", "text")).toBeGreaterThan(0);
    expect(compareResultValues("a", null, "text")).toBeLessThan(0);
    expect(compareResultValues(null, null, "text")).toBe(0);
  });
});

describe("sortResultRows", () => {
  it("sortiert typbewusst aufsteigend mit NULL zuletzt", () => {
    const kinds = detectColumnKinds(rows, columns);
    const sorted = sortResultRows(rows, [{ column: "id", direction: "asc" }], kinds);
    expect(sorted.map((row) => row.id)).toEqual(["2", "2", "10", "33"]);
    const byName = sortResultRows(rows, [{ column: "name", direction: "desc" }], kinds);
    expect(byName[byName.length - 1].name).toBeNull();
  });

  it("ist stabil und mehrspaltig", () => {
    const kinds = detectColumnKinds(rows, columns);
    const sorted = sortResultRows(
      rows,
      [
        { column: "id", direction: "asc" },
        { column: "name", direction: "desc" },
      ],
      kinds,
    );
    expect(sorted.map((row) => row.name)).toEqual(["Charlie", "alpha", "Bravo", null]);
    const stable = sortResultRows(rows, [{ column: "created", direction: "asc" }], kinds);
    expect(stable.slice(1, 3).map((row) => row.name)).toEqual(["Bravo", "Charlie"]);
  });

  it("lässt die Eingabe unverändert und gibt ohne Sortierung dieselbe Liste zurück", () => {
    const snapshot = rows.map((row) => row.id);
    sortResultRows(rows, [{ column: "id", direction: "desc" }]);
    expect(rows.map((row) => row.id)).toEqual(snapshot);
    expect(sortResultRows(rows, [])).toBe(rows);
  });
});

describe("toggleResultSort", () => {
  it("wechselt asc, desc und zurücksetzen", () => {
    const first = toggleResultSort([], "id");
    expect(first).toEqual([{ column: "id", direction: "asc" }]);
    const second = toggleResultSort(first, "id");
    expect(second).toEqual([{ column: "id", direction: "desc" }]);
    expect(toggleResultSort(second, "id")).toEqual([]);
  });

  it("ersetzt bei einfachem Klick und ergänzt bei additivem Klick", () => {
    const base = toggleResultSort([], "id");
    expect(toggleResultSort(base, "name")).toEqual([{ column: "name", direction: "asc" }]);
    const multi = toggleResultSort(base, "name", true);
    expect(multi).toHaveLength(2);
    expect(sortRankFor(multi, "name")).toBe(2);
    expect(sortDirectionFor(multi, "id")).toBe("asc");
    const desc = toggleResultSort(multi, "id", true);
    expect(sortDirectionFor(desc, "id")).toBe("desc");
    const removed = toggleResultSort(desc, "id", true);
    expect(removed).toEqual([{ column: "name", direction: "asc" }]);
    expect(sortRankFor(removed, "id")).toBeNull();
  });
});

describe("filterResultRows", () => {
  it("filtert enthält, ist gleich und NULL-Prädikate", () => {
    expect(matchesResultFilter("hallo welt", { operator: "contains", value: "WELT" })).toBe(true);
    expect(matchesResultFilter("hallo welt", { operator: "equals", value: "hallo" })).toBe(false);
    expect(matchesResultFilter("hallo", { operator: "equals", value: " HALLO " })).toBe(true);
    expect(matchesResultFilter(null, { operator: "is_null", value: "" })).toBe(true);
    expect(matchesResultFilter(null, { operator: "not_null", value: "" })).toBe(false);
    expect(matchesResultFilter(null, { operator: "contains", value: "a" })).toBe(false);
  });

  it("kombiniert mehrere Filter mit UND", () => {
    const filters: ResultFilters = {
      note: { operator: "contains", value: "hallo" },
      id: { operator: "equals", value: "2" },
    };
    const result = filterResultRows(rows, filters);
    expect(result).toHaveLength(2);
    expect(activeFilterCount(filters)).toBe(2);
  });

  it("ignoriert leere Filterwerte und lässt sich zurücksetzen", () => {
    expect(isFilterActive({ operator: "contains", value: "   " })).toBe(false);
    expect(isFilterActive({ operator: "is_null", value: "" })).toBe(true);
    expect(isFilterActive(undefined)).toBe(false);
    expect(filterResultRows(rows, { note: { operator: "contains", value: "" } })).toBe(rows);
    expect(filterResultRows(rows, {})).toBe(rows);
  });
});

describe("applyResultView", () => {
  it("filtert zuerst und sortiert danach", () => {
    const view = applyResultView(rows, columns, [{ column: "id", direction: "desc" }], {
      note: { operator: "not_null", value: "" },
    });
    expect(view.map((row) => row.id)).toEqual(["33", "2", "2"]);
    expect(rows).toHaveLength(4);
  });
});

describe("describeResultCount", () => {
  it("zeigt n von m nur bei Einschränkung", () => {
    expect(describeResultCount(4, 4)).toBe("4 Zeilen");
    expect(describeResultCount(2, 4)).toBe("2 von 4 Zeilen");
    expect(describeResultCount(1, 1)).toBe("1 Zeile");
  });

  it("benennt Operatoren", () => {
    expect(resultFilterOperatorLabel("contains")).toBe("enthält");
    expect(resultFilterOperatorLabel("is_null")).toBe("ist NULL");
    expect(resultFilterOperatorLabel("not_null")).toBe("ist nicht NULL");
    expect(resultFilterOperatorLabel("equals")).toBe("ist gleich");
  });
});

it("renders, filters and sorts MongoDB document values as JSON", async () => {
  const { resultCellText } = await import("../src/lib/result-grid");
  const document = { _id: { $oid: "507f1f77bcf86cd799439011" }, nested: { value: 250 } };
  expect(resultCellText(document.nested)).toBe('{"value":250}');
  expect(resultCellText([1, "two"])).toBe('[1,"two"]');
  expect(resultCellText(document._id)).toBe('{"$oid":"507f1f77bcf86cd799439011"}');
  expect(matchesResultFilter(document.nested, { operator: "contains", value: '"value":250' })).toBe(
    true,
  );
  expect(
    filterResultRows([document], { _id: { operator: "contains", value: "507f1f77" } }),
  ).toEqual([document]);
  expect(compareResultValues({ value: "a" }, { value: "b" }, "text")).toBeLessThan(0);
});
