import type {
  EditorAcceptSuggestionOnEnter,
  EditorTabCompletion,
  EditorWhitespace,
  EditorWrappingIndent,
} from "@/lib/settings";

export const WHITESPACE_OPTIONS: { value: EditorWhitespace; label: string }[] = [
  { value: "none", label: "Aus" },
  { value: "boundary", label: "Wortgrenzen" },
  { value: "selection", label: "In Auswahl" },
  { value: "trailing", label: "Zeilenenden" },
  { value: "all", label: "Alle" },
];

export const WRAPPING_INDENT_OPTIONS: { value: EditorWrappingIndent; label: string }[] = [
  { value: "same", label: "Gleich" },
  { value: "indent", label: "Eingerückt" },
  { value: "deepIndent", label: "Tief" },
];

export const ACCEPT_ON_ENTER_OPTIONS: { value: EditorAcceptSuggestionOnEnter; label: string }[] = [
  { value: "on", label: "Immer" },
  { value: "smart", label: "Smart" },
  { value: "off", label: "Nie" },
];

export const TAB_COMPLETION_OPTIONS: { value: EditorTabCompletion; label: string }[] = [
  { value: "off", label: "Aus" },
  { value: "onlySnippets", label: "Nur Snippets" },
  { value: "on", label: "An" },
];
