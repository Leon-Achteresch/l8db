import type {
  EditorAcceptSuggestionOnEnter,
  EditorFontFamily,
  EditorTabCompletion,
  EditorWhitespace,
  EditorWrappingIndent,
  SettingsState,
} from "@/lib/settings";

export type EditorSettings = Pick<
  SettingsState,
  | "editorFontSize"
  | "editorFontFamily"
  | "editorFontLigatures"
  | "editorLineHeight"
  | "editorTabSize"
  | "editorWordWrap"
  | "editorWrappingIndent"
  | "editorLineNumbers"
  | "editorMinimap"
  | "editorMinimapScale"
  | "editorBracketPairColorization"
  | "editorGuidesBracketPairs"
  | "editorGuidesIndentation"
  | "editorRenderWhitespace"
  | "editorRulers"
  | "editorSmoothScrolling"
  | "editorQuickSuggestions"
  | "editorSuggestOnTriggerCharacters"
  | "editorSuggestDelay"
  | "editorAcceptSuggestionOnEnter"
  | "editorTabCompletion"
  | "editorParameterHints"
  | "editorFormatOnPaste"
  | "editorFormatOnType"
>;

export interface EditorFontPreset {
  value: EditorFontFamily;
  label: string;
  stack: string;
}

export const EDITOR_FONT_PRESETS: EditorFontPreset[] = [
  {
    value: "system",
    label: "System-Mono",
    stack: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  {
    value: "sf-mono",
    label: "SF Mono",
    stack: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
  },
  {
    value: "menlo",
    label: "Menlo",
    stack: 'Menlo, ui-monospace, "SF Mono", Monaco, Consolas, monospace',
  },
  {
    value: "consolas",
    label: "Consolas",
    stack: 'Consolas, "Cascadia Code", ui-monospace, Menlo, monospace',
  },
  {
    value: "cascadia",
    label: "Cascadia Code",
    stack: '"Cascadia Code", Consolas, ui-monospace, Menlo, monospace',
  },
  {
    value: "fira",
    label: "Fira Code",
    stack: '"Fira Code", ui-monospace, Menlo, Consolas, monospace',
  },
  {
    value: "jetbrains",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
  },
];

export const DEFAULT_MONO_STACK = EDITOR_FONT_PRESETS[0].stack;

export function editorFontStack(family: EditorFontFamily): string {
  return EDITOR_FONT_PRESETS.find((preset) => preset.value === family)?.stack ?? DEFAULT_MONO_STACK;
}

export function editorLineHeightPx(fontSize: number, factor: number): number {
  return Math.max(8, Math.round(fontSize * factor));
}

export function parseRulersInput(text: string): number[] {
  const values = new Set<number>();
  for (const part of text.split(/[,;\s]+/)) {
    if (!part) continue;
    const parsed = Number.parseInt(part, 10);
    if (Number.isInteger(parsed) && parsed >= 20 && parsed <= 1000) values.add(parsed);
  }
  return [...values].sort((a, b) => a - b);
}

export function formatRulers(rulers: number[]): string {
  return rulers.join(", ");
}

export interface MonacoLikeEditorOptions {
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  lineHeight: number;
  tabSize: number;
  wordWrap: "on" | "off";
  wrappingIndent: EditorWrappingIndent;
  lineNumbers: "on" | "off";
  minimap: { enabled: boolean; scale: number; renderCharacters: boolean };
  bracketPairColorization: { enabled: boolean };
  guides: {
    bracketPairs: boolean | "active";
    bracketPairsHorizontal: boolean | "active";
    highlightActiveBracketPair: boolean;
    highlightActiveIndentation: boolean;
    indentation: boolean;
  };
  renderWhitespace: EditorWhitespace;
  rulers: number[];
  smoothScrolling: boolean;
  quickSuggestions: false | { other: boolean; comments: boolean; strings: boolean };
  suggestOnTriggerCharacters: boolean;
  quickSuggestionsDelay: number;
  acceptSuggestionOnEnter: EditorAcceptSuggestionOnEnter;
  tabCompletion: EditorTabCompletion;
  parameterHints: { enabled: boolean };
  formatOnPaste: boolean;
  formatOnType: boolean;
}

export function buildEditorOptions(settings: EditorSettings): MonacoLikeEditorOptions {
  return {
    fontFamily: editorFontStack(settings.editorFontFamily),
    fontSize: settings.editorFontSize,
    fontLigatures: settings.editorFontLigatures,
    lineHeight: editorLineHeightPx(settings.editorFontSize, settings.editorLineHeight),
    tabSize: settings.editorTabSize,
    wordWrap: settings.editorWordWrap ? "on" : "off",
    wrappingIndent: settings.editorWrappingIndent,
    lineNumbers: settings.editorLineNumbers ? "on" : "off",
    minimap: {
      enabled: settings.editorMinimap,
      scale: settings.editorMinimapScale,
      renderCharacters: true,
    },
    bracketPairColorization: { enabled: settings.editorBracketPairColorization },
    guides: {
      bracketPairs: settings.editorGuidesBracketPairs ? "active" : false,
      bracketPairsHorizontal: settings.editorGuidesBracketPairs ? "active" : false,
      highlightActiveBracketPair: settings.editorGuidesBracketPairs,
      highlightActiveIndentation: settings.editorGuidesIndentation,
      indentation: settings.editorGuidesIndentation,
    },
    renderWhitespace: settings.editorRenderWhitespace,
    rulers: [...settings.editorRulers],
    smoothScrolling: settings.editorSmoothScrolling,
    quickSuggestions: settings.editorQuickSuggestions
      ? { other: true, comments: false, strings: false }
      : false,
    suggestOnTriggerCharacters: settings.editorSuggestOnTriggerCharacters,
    quickSuggestionsDelay: settings.editorSuggestDelay,
    acceptSuggestionOnEnter: settings.editorAcceptSuggestionOnEnter,
    tabCompletion: settings.editorTabCompletion,
    parameterHints: { enabled: settings.editorParameterHints },
    formatOnPaste: settings.editorFormatOnPaste,
    formatOnType: settings.editorFormatOnType,
  };
}
