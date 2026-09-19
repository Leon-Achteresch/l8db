import { type RefObject, useEffect } from "react";

import { buildEditorOptions } from "@/lib/editor-options";
import type { monaco } from "@/lib/monaco";

import type { EditorSettings } from "./use-editor-settings";

export function useEditorOptionsSync(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  settings: EditorSettings,
) {
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions(buildEditorOptions(settings));
  }, [
    settings.editorFontSize,
    settings.editorFontFamily,
    settings.editorFontLigatures,
    settings.editorLineHeight,
    settings.editorTabSize,
    settings.editorWordWrap,
    settings.editorWrappingIndent,
    settings.editorLineNumbers,
    settings.editorMinimap,
    settings.editorMinimapScale,
    settings.editorBracketPairColorization,
    settings.editorGuidesBracketPairs,
    settings.editorGuidesIndentation,
    settings.editorRenderWhitespace,
    settings.editorRulers,
    settings.editorSmoothScrolling,
    settings.editorQuickSuggestions,
    settings.editorSuggestOnTriggerCharacters,
    settings.editorSuggestDelay,
    settings.editorAcceptSuggestionOnEnter,
    settings.editorTabCompletion,
    settings.editorParameterHints,
    settings.editorFormatOnPaste,
    settings.editorFormatOnType,
  ]);
}
