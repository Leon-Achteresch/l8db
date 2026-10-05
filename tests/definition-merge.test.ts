import { expect, test } from "bun:test";
import {
  applyDefinitionHunk,
  definitionHunks,
  draftLineOrigins,
  unchangedLineRanges,
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

test("findet in großen Definitionen nur die tatsächlich geänderten Zeilen", () => {
  const body = Array.from({ length: 3000 }, (_, index) => `line ${index}`);
  const source = ["PACKAGE SPEC REAL.PA", ...body, "END REAL;"].join("\n");
  const draft = [
    "PACKAGE SPEC REAL_TEST.PA",
    ...body.slice(0, 1500),
    "extra",
    ...body.slice(1500),
    "END REAL_TEST;",
  ].join("\n");
  const hunks = definitionHunks(source, draft);
  expect(hunks).toEqual([
    { sourceStart: 0, sourceEnd: 1, draftStart: 0, draftEnd: 1 },
    { sourceStart: 1501, sourceEnd: 1501, draftStart: 1501, draftEnd: 1502 },
    { sourceStart: 3001, sourceEnd: 3002, draftStart: 3002, draftEnd: 3003 },
  ]);
});

test("Hunks überführen den Entwurf zufällig veränderter Texte vollständig in die Quelle", () => {
  let seed = 7;
  const random = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
  for (let round = 0; round < 200; round++) {
    const source = Array.from({ length: random(30) }, () => `l${random(6)}`).join("\n");
    const draft = Array.from({ length: random(30) }, () => `l${random(6)}`).join("\n");
    const hunks = definitionHunks(source, draft);
    const merged = hunks.reduceRight(
      (text, hunk) => applyDefinitionHunk(source, text, hunk),
      draft,
    );
    expect(merged).toBe(source);
  }
});

test("unchangedLineRanges keeps one context line around each hunk", () => {
  const hunks = [
    { sourceStart: 3, sourceEnd: 4, draftStart: 3, draftEnd: 3 },
    { sourceStart: 8, sourceEnd: 8, draftStart: 7, draftEnd: 9 },
  ];
  expect(unchangedLineRanges(hunks, "source", 12)).toEqual([
    { start: 2, end: 2 },
    { start: 6, end: 7 },
    { start: 10, end: 11 },
  ]);
  expect(unchangedLineRanges(hunks, "draft", 13)).toEqual([
    { start: 2, end: 2 },
    { start: 5, end: 6 },
    { start: 11, end: 12 },
  ]);
  expect(unchangedLineRanges([], "source", 3)).toEqual([{ start: 2, end: 2 }]);
});
