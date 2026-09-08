import { describe, expect, test } from "bun:test";
import {
  QUERY_WORKSPACE_DEFAULTS,
  QUERY_WORKSPACE_PRESETS,
  sanitizeWorkspace,
} from "../src/lib/query-workspace";

describe("query workspace persistence", () => {
  test("ignores corrupted values and never restores actions from storage", () => {
    expect(
      sanitizeWorkspace({
        layout: "diagonal",
        editorShare: NaN,
        toolsVisible: "false",
        update: "broken",
        resultView: "html",
      }),
    ).toEqual({});
    expect(sanitizeWorkspace(null)).toEqual({});
    expect(sanitizeWorkspace("invalid")).toEqual({});
  });
  test("bounds panel sizes so editor and results remain reachable", () => {
    expect(
      sanitizeWorkspace({ editorShare: 1000, navigatorShare: -10, resultFontSize: 200 }),
    ).toEqual({ editorShare: 80, navigatorShare: 15, resultFontSize: 20 });
  });
  test("round-trips every workspace option", () => {
    expect(sanitizeWorkspace(JSON.parse(JSON.stringify(QUERY_WORKSPACE_DEFAULTS)))).toEqual(
      QUERY_WORKSPACE_DEFAULTS,
    );
  });
  test("layout presets preserve custom typing and execution preferences", () => {
    for (const preset of Object.values(QUERY_WORKSPACE_PRESETS)) {
      const result = {
        ...QUERY_WORKSPACE_DEFAULTS,
        cursorStyle: "block",
        runTarget: "all",
        ...sanitizeWorkspace(preset),
      };
      expect(result.cursorStyle).toBe("block");
      expect(result.runTarget).toBe("all");
      expect(result.editorShare).toBeGreaterThanOrEqual(20);
      expect(result.editorShare).toBeLessThanOrEqual(80);
    }
  });
});
