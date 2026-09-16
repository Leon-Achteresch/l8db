import { describe, expect, it } from "bun:test";
import { serializeRows } from "@/lib/export";

const columns = ["id", "name"];
const rows = [
  { id: 1, name: "a|b" },
  { id: 2, name: null },
];

describe("serializeRows", () => {
  it("csv", () => {
    expect(serializeRows(columns, rows, "csv")).toBe("id,name\n1,a|b\n2,");
  });
  it("tsv", () => {
    expect(serializeRows(columns, rows, "tsv")).toBe("id\tname\n1\ta|b\n2\t");
  });
  it("markdown escapt pipes", () => {
    expect(serializeRows(columns, rows, "markdown")).toBe(
      "| id | name |\n| --- | --- |\n| 1 | a\\|b |\n| 2 |  |",
    );
  });
  it("markdown escapt pipes in spaltennamen", () => {
    expect(serializeRows(["a|b"], [], "markdown")).toBe("| a\\|b |\n| --- |");
  });
  it("json", () => {
    expect(JSON.parse(serializeRows(columns, rows, "json"))).toEqual(rows);
  });
});
