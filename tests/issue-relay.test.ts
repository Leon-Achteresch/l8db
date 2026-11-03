import { expect, test } from "bun:test";
import { invalid, quiet } from "../services/issue-relay/src/index.js";

test("issue relay rejects malformed reports and defuses mentions", () => {
  expect(invalid(null)).toBeTruthy();
  expect(invalid({ title: " ", body: "x" })).toContain("Titel");
  expect(invalid({ title: "t".repeat(201), body: "x" })).toContain("Titel");
  expect(invalid({ title: "Absturz", body: "b".repeat(60_001) })).toContain("Beschreibung");
  expect(invalid({ title: "Absturz", body: "x", screenshot: "R0lGODlh" })).toContain("PNG");
  expect(invalid({ title: "Absturz", body: "x", screenshot: "iVBORw0KGgoAAAA" })).toBeNull();
  expect(invalid({ title: "Absturz", body: "x" })).toBeNull();
  expect(quiet("hi @octocat and mail a@b")).toBe("hi @​octocat and mail a@​b");
});
