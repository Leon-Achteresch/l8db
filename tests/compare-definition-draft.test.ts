import { describe, expect, test } from "bun:test";

import { definitionDraftPatch } from "../src/features/compare/definition-draft";
import type { CompareWorkspace } from "../src/lib/table-tabs/types";

type Bases = Pick<CompareWorkspace, "draft" | "draftBase" | "sourceBase">;

function apply(workspace: Bases, patch: Partial<CompareWorkspace>): Bases {
  return { ...workspace, ...patch };
}

const targetBaseline = (workspace: Bases, loaded: string) => workspace.draftBase ?? loaded;
const sourceBaseline = (workspace: Bases, loaded: string) => workspace.sourceBase ?? loaded;

describe("Definitionsvergleich: Entwurf und Ausgangsstand", () => {
  test("merkt sich beim ersten Bearbeiten den geladenen Stand", () => {
    let workspace: Bases = { draft: null, draftBase: null, sourceBase: null };
    workspace = apply(
      workspace,
      definitionDraftPatch(workspace, {
        type: "edit",
        draft: "v1 edit",
        sourceBaseline: "s1",
        targetBaseline: "t1",
      }),
    );
    workspace = apply(
      workspace,
      definitionDraftPatch(workspace, {
        type: "edit",
        draft: "v1 edit 2",
        sourceBaseline: "s2",
        targetBaseline: "t2",
      }),
    );
    expect(workspace).toEqual({ draft: "v1 edit 2", draftBase: "t1", sourceBase: "s1" });
  });

  test("übernimmt nach Neu laden den aktuellen Stand als Ausgangsstand und behält den Entwurf", () => {
    let workspace: Bases = { draft: null, draftBase: null, sourceBase: null };
    workspace = apply(
      workspace,
      definitionDraftPatch(workspace, {
        type: "edit",
        draft: "entwurf",
        sourceBaseline: "quelle alt",
        targetBaseline: "ziel alt",
      }),
    );
    expect(targetBaseline(workspace, "ziel extern geändert")).toBe("ziel alt");
    workspace = apply(workspace, definitionDraftPatch(workspace, { type: "reload" }));
    expect(workspace.draft).toBe("entwurf");
    expect(targetBaseline(workspace, "ziel extern geändert")).toBe("ziel extern geändert");
    expect(sourceBaseline(workspace, "quelle extern geändert")).toBe("quelle extern geändert");
  });

  test("Anwenden und Verwerfen setzen nur die betroffenen Stände zurück", () => {
    const workspace: Bases = { draft: "d", draftBase: "t", sourceBase: "s" };
    expect(definitionDraftPatch(workspace, { type: "applied", side: "left" })).toEqual({
      sourceBase: null,
    });
    expect(definitionDraftPatch(workspace, { type: "applied", side: "right" })).toEqual({
      draftBase: null,
    });
    expect(definitionDraftPatch(workspace, { type: "discard" })).toEqual({
      draft: null,
      draftBase: null,
      sourceBase: null,
    });
  });
});
