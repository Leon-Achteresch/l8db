import { expect, test } from "bun:test";
import { documentPath } from "../src/features/baas/firebase-firestore-view";

test("keeps nested collections named documents in the Firestore parent path", () => {
  const base = "projects/p/databases/(default)/documents/";
  expect(documentPath({ name: `${base}users/u1/documents/d1` })).toBe("users/u1/documents/d1");
  expect(documentPath({ name: `${base}documents/d1/documents/x` })).toBe(
    "documents/d1/documents/x",
  );
  expect(documentPath({ name: "invalid" })).toBe("");
});
