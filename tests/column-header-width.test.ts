import { describe, expect, test } from "bun:test";
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
