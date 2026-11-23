import { expect, test } from "bun:test";
import { jsonFilterError } from "../src/lib/json-filter";

test("MongoDB filters must be JSON objects before they are applied", () => {
  expect(jsonFilterError("")).toBeNull();
  expect(jsonFilterError('{"status": "open"}')).toBeNull();
  expect(jsonFilterError('{"status": ')).toContain("gültiges JSON-Objekt");
  expect(jsonFilterError("status = 'open'")).toContain("gültiges JSON-Objekt");
  expect(jsonFilterError("[1]")).toContain("gültiges JSON-Objekt");
  expect(jsonFilterError("null")).toContain("gültiges JSON-Objekt");
});
