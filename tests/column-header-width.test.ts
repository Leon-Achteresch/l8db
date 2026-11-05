import { describe, expect, test } from "bun:test";
import { classicColumnWidth } from "../src/lib/column-content-width";
import {
  COLUMN_SIZE_MAX,
  fitHeaderColumnWidth,
  HEADER_FIT_CHROME,
  HEADER_FIT_FK,
} from "../src/lib/column-header-width";

describe("fitHeaderColumnWidth", () => {
  test("legt die Breite auf Titel plus Header-Chrome", () => {
    expect(fitHeaderColumnWidth(40)).toBe(40 + HEADER_FIT_CHROME);
    expect(fitHeaderColumnWidth(40, true)).toBe(40 + HEADER_FIT_CHROME + HEADER_FIT_FK);
  });

  test("hält das Maximum ein", () => {
    expect(fitHeaderColumnWidth(0)).toBe(HEADER_FIT_CHROME);
    expect(fitHeaderColumnWidth(4000)).toBe(COLUMN_SIZE_MAX);
  });
});

test("classic start width follows the widest of name, type line and loaded values, capped at 320", () => {
  const id = classicColumnWidth({
    name: "id",
    typeLabel: "integer",
    icons: 2,
    values: [10480, 10481],
  });
  expect(id).toBe(80);
  const customer = classicColumnWidth({
    name: "customer",
    typeLabel: "text",
    icons: 1,
    values: ["Müller Logistik GmbH", "Kessler Maschinenbau"],
  });
  expect(customer).toBe(181);
  const notes = classicColumnWidth({
    name: "notes",
    typeLabel: "text",
    icons: 1,
    values: ["x".repeat(500)],
  });
  expect(notes).toBe(320);
});
