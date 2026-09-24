import { expect, test } from "bun:test";
import {
  applyDefinitionHunk,
  definitionHunks,
  draftLineOrigins,
} from "../src/lib/definition-merge";

test("übernimmt unabhängige Änderungen von beiden Seiten in einen Entwurf", () => {
  const source = "SELECT\n  id,\n  source_value,\n  common_value\nFROM records";
  const target = "SELECT\n  id,\n  target_value,\n  common_value\nFROM records";
  const draft = "SELECT\n  id,\n  target_value,\n  common_value\nFROM records WHERE active";
  const hunks = definitionHunks(source, draft);
  expect(hunks).toHaveLength(2);
  const merged = applyDefinitionHunk(source, draft, hunks[0]);
  expect(merged).toBe("SELECT\n  id,\n  source_value,\n  common_value\nFROM records WHERE active");
  expect(definitionHunks(target, merged)).toHaveLength(2);
});

test("übernimmt eingefügte und entfernte Zeilen ohne Nachbaränderungen zu verlieren", () => {
  const source = "a\nb\nc";
  const draft = "a\nextra\nc";
  const [hunk] = definitionHunks(source, draft);
  expect(applyDefinitionHunk(source, draft, hunk)).toBe(source);
  expect(definitionHunks(source, source)).toEqual([]);
  expect(applyDefinitionHunk("a\nb\nc\nd", source, definitionHunks("a\nb\nc\nd", source)[0])).toBe(
    "a\nb\nc\nd",
  );
});

test("markiert Entwurfszeilen nach ihrer Herkunft aus Quelle oder Ziel", () => {
  const source = "a\nsource\nb\nc";
  const target = "a\nb\ntarget\nc";
  const draft = "a\nsource\nb\ntarget\nmanual\nc";
  expect(
    draftLineOrigins(definitionHunks(source, draft), definitionHunks(target, draft), 6),
  ).toEqual([null, "source", null, "target", null, null]);
});
