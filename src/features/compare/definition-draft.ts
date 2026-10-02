import type { CompareWorkspace } from "@/lib/table-tabs/types";

export type DefinitionDraftEvent =
  | { type: "edit"; draft: string; sourceBaseline: string; targetBaseline: string }
  | { type: "applied"; side: "left" | "right" }
  | { type: "reload" }
  | { type: "discard" };

export function definitionDraftPatch(
  workspace: Pick<CompareWorkspace, "draftBase" | "sourceBase">,
  event: DefinitionDraftEvent,
): Partial<CompareWorkspace> {
  switch (event.type) {
    case "edit":
      return {
        draft: event.draft,
        sourceBase: workspace.sourceBase ?? event.sourceBaseline,
        draftBase: workspace.draftBase ?? event.targetBaseline,
      };
    case "applied":
      return event.side === "left" ? { sourceBase: null } : { draftBase: null };
    case "reload":
      return { sourceBase: null, draftBase: null };
    case "discard":
      return { draft: null, draftBase: null, sourceBase: null };
  }
}
