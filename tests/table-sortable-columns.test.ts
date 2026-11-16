import { describe, expect, test } from "bun:test";
import {
  applicableSorting,
  sortableColumnNames,
} from "../src/features/table/table-view/sortable-columns";

const column = (name: string, data_type: string, comment: string | null = null) => ({
  name,
  data_type,
  comment,
  is_nullable: true,
  column_default: null,
  is_primary_key: false,
  ordinal_position: 1,
  character_maximum_length: null,
});

describe("sortierbare Spalten", () => {
  test("DynamoDB bietet keine Sortierung an", () => {
    expect(sortableColumnNames("none", undefined)).toEqual([]);
    expect(applicableSorting([{ id: "pk", desc: false }], [])).toEqual([]);
  });

  test("Elasticsearch sortiert Textfelder nur mit Keyword-Unterfeld", () => {
    const details = [
      column("_id", "keyword"),
      column("title", "text"),
      column("name", "text", "Keyword-Feld: name.keyword"),
      column("meta", "object"),
      column("count", "long"),
    ];
    expect(sortableColumnNames("keyword", details)).toEqual(["_id", "name", "count"]);
  });

  test("gespeicherte Sortierung auf nicht sortierbaren Spalten wird ignoriert", () => {
    const stored = [
      { id: "title", desc: true },
      { id: "count", desc: false },
    ];
    expect(applicableSorting(stored, ["count"])).toEqual([{ id: "count", desc: false }]);
    expect(applicableSorting(stored, undefined)).toBe(stored);
    expect(sortableColumnNames("columns", [column("a", "text")])).toBeUndefined();
  });
});
