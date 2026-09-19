import { useSettingsStore } from "@/lib/settings";

export function useEditorSettings() {
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorFontLigatures = useSettingsStore((s) => s.editorFontLigatures);
  const editorLineHeight = useSettingsStore((s) => s.editorLineHeight);
  const editorTabSize = useSettingsStore((s) => s.editorTabSize);
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap);
  const editorWrappingIndent = useSettingsStore((s) => s.editorWrappingIndent);
  const editorLineNumbers = useSettingsStore((s) => s.editorLineNumbers);
  const editorMinimap = useSettingsStore((s) => s.editorMinimap);
  const editorMinimapScale = useSettingsStore((s) => s.editorMinimapScale);
  const editorBracketPairColorization = useSettingsStore((s) => s.editorBracketPairColorization);
  const editorGuidesBracketPairs = useSettingsStore((s) => s.editorGuidesBracketPairs);
  const editorGuidesIndentation = useSettingsStore((s) => s.editorGuidesIndentation);
  const editorRenderWhitespace = useSettingsStore((s) => s.editorRenderWhitespace);
  const editorRulers = useSettingsStore((s) => s.editorRulers);
  const editorSmoothScrolling = useSettingsStore((s) => s.editorSmoothScrolling);
  const editorQuickSuggestions = useSettingsStore((s) => s.editorQuickSuggestions);
  const editorSuggestOnTriggerCharacters = useSettingsStore(
    (s) => s.editorSuggestOnTriggerCharacters,
  );
  const editorSuggestDelay = useSettingsStore((s) => s.editorSuggestDelay);
  const editorAcceptSuggestionOnEnter = useSettingsStore((s) => s.editorAcceptSuggestionOnEnter);
  const editorTabCompletion = useSettingsStore((s) => s.editorTabCompletion);
  const editorParameterHints = useSettingsStore((s) => s.editorParameterHints);
  const editorFormatOnPaste = useSettingsStore((s) => s.editorFormatOnPaste);
  const editorFormatOnType = useSettingsStore((s) => s.editorFormatOnType);
  return {
    editorFontSize,
    editorFontFamily,
    editorFontLigatures,
    editorLineHeight,
    editorTabSize,
    editorWordWrap,
    editorWrappingIndent,
    editorLineNumbers,
    editorMinimap,
    editorMinimapScale,
    editorBracketPairColorization,
    editorGuidesBracketPairs,
    editorGuidesIndentation,
    editorRenderWhitespace,
    editorRulers,
    editorSmoothScrolling,
    editorQuickSuggestions,
    editorSuggestOnTriggerCharacters,
    editorSuggestDelay,
    editorAcceptSuggestionOnEnter,
    editorTabCompletion,
    editorParameterHints,
    editorFormatOnPaste,
    editorFormatOnType,
  };
}

export type EditorSettings = ReturnType<typeof useEditorSettings>;
