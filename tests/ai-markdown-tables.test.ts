import { expect, test } from "bun:test";
import { parseAiMarkdownTables } from "../src/lib/ai/markdown-tables";

test("AI answers render native Markdown tables separately from surrounding prose", () => {
  const blocks = parseAiMarkdownTables(
    "Results\n\n| Column | Type |\n| :--- | ---: |\n| **id** | `integer` |\n| name | text |\n\nNext step",
  );
  expect(blocks.map((block) => block.type)).toEqual(["markdown", "table", "markdown"]);
  expect(blocks[1]).toMatchObject({
    columns: [
      { label: "Column", align: "left" },
      { label: "Type", align: "right" },
    ],
    rows: [{ cells: ["**id**", "`integer`"] }, { cells: ["name", "text"] }],
  });
});

test("AI tables preserve escaped pipes and pipes inside single or multiple backtick code spans", () => {
  const blocks = parseAiMarkdownTables(
    "Name | Example | Notes\n--- | :---: | ---\na\\|b | `x|y` | ``a`|b``\nc | end\\| | plain",
  );
  expect(blocks[0]).toMatchObject({
    type: "table",
    columns: [{ label: "Name" }, { label: "Example", align: "center" }, { label: "Notes" }],
    rows: [{ cells: ["a|b", "`x|y`", "``a`|b``"] }, { cells: ["c", "end|", "plain"] }],
  });
});

test("incomplete streaming separators and ordinary pipe text stay Markdown", () => {
  for (const source of [
    "a | b\n--- | --",
    "a | b\n---",
    "SELECT a | b",
    "| one |\n| -- |\n| row |",
  ])
    expect(parseAiMarkdownTables(source)).toEqual([
      { type: "markdown", id: "text-0", text: source },
    ]);
  expect(parseAiMarkdownTables("| one |\n| --- |\n| row |")[0]).toMatchObject({
    type: "table",
    rows: [{ cells: ["row"] }],
  });
});

test("escaped and unmatched backticks do not swallow following table cells", () => {
  const blocks = parseAiMarkdownTables(
    "| Value | Notes |\n| --- | --- |\n| \\`literal | retained |\n| `unfinished | retained |\n| ``unfinished | retained |",
  );
  expect(blocks[0]).toMatchObject({
    type: "table",
    rows: [
      { cells: ["\\`literal", "retained"] },
      { cells: ["`unfinished", "retained"] },
      { cells: ["``unfinished", "retained"] },
    ],
  });
});
