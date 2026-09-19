import { describe, expect, test } from "bun:test";
import {
  canLink,
  chainMasters,
  isAncestor,
  linkAnchor,
  masterCandidates,
  normalizeMasters,
  removeMaster,
  spreadAnchors,
  swapMasters,
} from "../src/lib/split-links";

const table = (name: string) => ({ kind: "table" as const, schema: "public", table: name });
const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("split links", () => {
  test("erkennt Vorfahren und verhindert Zyklen bei der Master-Auswahl", () => {
    const chain = [null, 0, 1, 2];
    expect(isAncestor(chain, 0, 3)).toBe(true);
    expect(isAncestor(chain, 3, 0)).toBe(false);
    const tabs = [table("a"), table("b"), table("c"), table("d")];
    expect(masterCandidates(chain, tabs, 0)).toEqual([]);
    expect(masterCandidates(chain, tabs, 2)).toEqual([0, 1]);
    expect(masterCandidates([null, 0, 0, 0], tabs, 0)).toEqual([]);
    expect(masterCandidates([null, 0, 0, 0], tabs, 3)).toEqual([0, 1, 2]);
  });

  test("leere Bereiche sind nur als verknüpftes Detail ein Master", () => {
    const tabs = [table("a"), undefined, undefined];
    expect(canLink([null, 0, null], tabs, 1, 2)).toBe(true);
    expect(canLink([null, 0, null], tabs, 2, 1)).toBe(false);
    expect(
      canLink([null, null], [{ kind: "tool", tool: "monitor" } as never, table("b")], 0, 1),
    ).toBe(false);
  });

  test("normalisiert gespeicherte Master und fällt auf die Kette zurück", () => {
    expect(normalizeMasters(undefined, 3)).toEqual(chainMasters(3));
    expect(normalizeMasters([null, 0, 0, 0], 4)).toEqual([null, 0, 0, 0]);
    expect(normalizeMasters([1, 0], 2)).toEqual([null, 0]);
    expect(normalizeMasters([null, 1], 2)).toEqual([null, 0]);
    expect(normalizeMasters([null, 5], 2)).toEqual([null, 0]);
    expect(normalizeMasters([null, 0], 3)).toEqual([null, 0, 1]);
  });

  test("Beziehungen folgen beim Tauschen den Inhalten und lösen sich beim Schließen", () => {
    expect(swapMasters([null, 0], 0, 1)).toEqual([1, null]);
    expect(swapMasters([null, 0, 1, 2], 1, 3)).toEqual([null, 2, 3, 0]);
    expect(removeMaster([null, 0, 0, 2], 0)).toEqual([null, null, 1]);
    expect(removeMaster([null, 0, 1, 2], 1)).toEqual([null, null, 1]);
  });

  test("setzt Pfeile auf die gemeinsame Kante von Master und Detail", () => {
    const left = box(0, 0, 600, 900);
    const topRight = box(601, 0, 1200, 450);
    const bottomRight = box(601, 451, 1200, 900);
    expect(linkAnchor(left, topRight)).toEqual({ x: 600.5, y: 225, angle: 0 });
    expect(linkAnchor(left, bottomRight)).toEqual({ x: 600.5, y: 675.5, angle: 0 });
    expect(linkAnchor(topRight, left)).toEqual({ x: 600.5, y: 225, angle: 180 });
    expect(linkAnchor(topRight, bottomRight)).toEqual({ x: 900.5, y: 450.5, angle: 90 });
    expect(linkAnchor(bottomRight, topRight).angle).toBe(-90);
    const topLeft = box(0, 0, 600, 450);
    const bottomLeft = box(0, 451, 600, 900);
    expect(linkAnchor(topLeft, bottomRight)).toMatchObject({ x: 600.5, y: 450.5 });
    expect(Math.round(linkAnchor(topLeft, bottomRight).angle)).toBe(45);
    expect(Math.round(linkAnchor(topRight, bottomLeft).angle)).toBe(135);
    expect(Math.round(linkAnchor(bottomLeft, topRight).angle)).toBe(-45);
    expect(linkAnchor(topLeft, box(400, 451, 1200, 900))).toEqual({ x: 500, y: 450.5, angle: 90 });
  });

  test("verschiebt kollidierende Pfeile an der Kreuzung", () => {
    const crossing = { x: 600, y: 450 };
    const [first, second] = spreadAnchors([
      { ...crossing, angle: 45 },
      { ...crossing, angle: 135 },
    ]);
    expect(first).toEqual({ ...crossing, angle: 45 });
    expect(second.x).toBe(600);
    expect(second.y).toBeLessThan(450 - 20);
    const apart = spreadAnchors([
      { x: 600, y: 225, angle: 0 },
      { x: 600, y: 675, angle: 0 },
    ]);
    expect(apart.map((anchor) => anchor.y)).toEqual([225, 675]);
  });
});
