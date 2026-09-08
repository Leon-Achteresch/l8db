import { expect, test } from "bun:test";

import {
  buildEditorOptions,
  DEFAULT_MONO_STACK,
  type EditorSettings,
  editorFontStack,
  editorLineHeightPx,
  formatRulers,
  parseRulersInput,
} from "../src/lib/editor-options";
import { summarizeStatement } from "../src/lib/sql-statements";

const BASE_SETTINGS: EditorSettings = {
  editorFontSize: 13,
  editorFontFamily: "system",
  editorFontLigatures: false,
  editorLineHeight: 1.8,
  editorTabSize: 2,
  editorWordWrap: true,
  editorWrappingIndent: "same",
  editorLineNumbers: true,
  editorMinimap: false,
  editorMinimapScale: 1,
  editorBracketPairColorization: true,
  editorGuidesBracketPairs: true,
  editorGuidesIndentation: false,
  editorRenderWhitespace: "selection",
  editorRulers: [],
  editorSmoothScrolling: true,
  editorQuickSuggestions: true,
  editorSuggestOnTriggerCharacters: true,
  editorSuggestDelay: 50,
  editorAcceptSuggestionOnEnter: "on",
  editorTabCompletion: "off",
  editorParameterHints: true,
  editorFormatOnPaste: false,
  editorFormatOnType: false,
};

test("editorFontStack resolves presets and falls back to the default stack", () => {
  expect(editorFontStack("system")).toBe(DEFAULT_MONO_STACK);
  expect(editorFontStack("fira")).toContain("Fira Code");
  expect(editorFontStack("jetbrains")).toContain("JetBrains Mono");
  expect(editorFontStack("unknown" as never)).toBe(DEFAULT_MONO_STACK);
});

test("editorLineHeightPx scales with the font size and never collapses", () => {
  expect(editorLineHeightPx(13, 1.8)).toBe(23);
  expect(editorLineHeightPx(10, 1.2)).toBe(12);
  expect(editorLineHeightPx(10, 0)).toBe(8);
});

test("parseRulersInput accepts comma and space separated columns", () => {
  expect(parseRulersInput("80, 120")).toEqual([80, 120]);
  expect(parseRulersInput("120 80;100")).toEqual([80, 100, 120]);
  expect(parseRulersInput("")).toEqual([]);
});

test("parseRulersInput drops invalid values and duplicates", () => {
  expect(parseRulersInput("abc, -5, 10, 5000, 80, 80")).toEqual([80]);
  expect(formatRulers([120, 80])).toBe("120, 80");
  expect(formatRulers(parseRulersInput("120, 80"))).toBe("80, 120");
});

test("buildEditorOptions maps settings to monaco options", () => {
  const options = buildEditorOptions(BASE_SETTINGS);
  expect(options.fontSize).toBe(13);
  expect(options.lineHeight).toBe(23);
  expect(options.wordWrap).toBe("on");
  expect(options.minimap).toEqual({ enabled: false, scale: 1, renderCharacters: true });
  expect(options.bracketPairColorization).toEqual({ enabled: true });
  expect(options.guides.bracketPairs).toBe("active");
  expect(options.guides.indentation).toBe(false);
  expect(options.quickSuggestions).toEqual({ other: true, comments: false, strings: false });
  expect(options.quickSuggestionsDelay).toBe(50);
  expect(options.rulers).toEqual([]);
});

test("buildEditorOptions disables suggestions and wrap on demand", () => {
  const options = buildEditorOptions({
    ...BASE_SETTINGS,
    editorWordWrap: false,
    editorQuickSuggestions: false,
    editorLineNumbers: false,
    editorMinimap: true,
    editorMinimapScale: 2,
    editorRulers: [100],
  });
  expect(options.wordWrap).toBe("off");
  expect(options.quickSuggestions).toBe(false);
  expect(options.lineNumbers).toBe("off");
  expect(options.minimap.enabled).toBe(true);
  expect(options.minimap.scale).toBe(2);
  expect(options.rulers).toEqual([100]);
});

test("summarizeStatement detects the statement kind and shortens the preview", () => {
  expect(summarizeStatement("select * from users;").kind).toBe("SELECT");
  expect(summarizeStatement("  -- Kommentar\n  update users set x = 1").kind).toBe("UPDATE");
  expect(summarizeStatement("/* Hinweis */\nWITH cte AS (SELECT 1) SELECT * FROM cte").kind).toBe(
    "WITH",
  );
  const long = `select ${"a".repeat(100)} from t`;
  const summary = summarizeStatement(long);
  expect(summary.preview.length).toBeLessThanOrEqual(81);
  expect(summary.preview.endsWith("…")).toBe(true);
});
