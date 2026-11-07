import { expect, test } from "bun:test";
import { pendingEnterItem } from "../src/components/motion/command-palette/pending-enter";

test("Enter während des Rankings wählt den ersten Treffer, sobald das Ranking zur Eingabe passt", () => {
  expect(pendingEnterItem("tab", "ta", "tab", ["a"])).toBeUndefined();
  expect(pendingEnterItem("tab", "tab", "tab", ["first", "second"])).toBe("first");
  expect(pendingEnterItem("tab", "table", "table", ["first"])).toBeUndefined();
  expect(pendingEnterItem(null, "tab", "tab", ["first"])).toBeUndefined();
  expect(pendingEnterItem("tab", "tab", "tab", [])).toBeUndefined();
});
