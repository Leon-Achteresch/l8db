import * as monaco from "monaco-editor/editor/editor.api";
import {
  conf as sqlConf,
  language as sqlLanguage,
} from "monaco-editor/languages/definitions/sql/sql";

const plsqlKeywords = [
  "BODY",
  "BULK",
  "COLLECT",
  "CONSTANT",
  "CURSOR",
  "DETERMINISTIC",
  "ELSIF",
  "EXCEPTION",
  "EXIT",
  "FORALL",
  "FUNCTION",
  "IMMUTABLE",
  "LANGUAGE",
  "LOOP",
  "NOTICE",
  "OUT",
  "PACKAGE",
  "PARALLEL_ENABLE",
  "PIPELINED",
  "PRAGMA",
  "PROCEDURE",
  "RAISE",
  "RECORD",
  "REF",
  "RETURN",
  "RETURNS",
  "REVERSE",
  "ROWTYPE",
  "SQLCODE",
  "SQLERRM",
  "STABLE",
  "STRICT",
  "TYPE",
  "VARRAY",
  "PLPGSQL",
  "PERFORM",
  "SLICE",
];

monaco.editor.addKeybindingRules([
  { keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, command: "editor.action.gotoLine" },
  { keybinding: monaco.KeyMod.WinCtrl | monaco.KeyCode.LeftArrow, command: "cursorWordLeft" },
  { keybinding: monaco.KeyMod.WinCtrl | monaco.KeyCode.RightArrow, command: "cursorWordRight" },
  {
    keybinding: monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.LeftArrow,
    command: "cursorWordLeftSelect",
  },
  {
    keybinding: monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.RightArrow,
    command: "cursorWordRightSelect",
  },
]);

monaco.languages.register({ id: "plsql" });

monaco.languages.setLanguageConfiguration("plsql", sqlConf);

monaco.languages.setMonarchTokensProvider("plsql", {
  ...sqlLanguage,
  keywords: [...sqlLanguage.keywords, ...plsqlKeywords],
});

monaco.languages.register({ id: "redis" });

monaco.languages.setLanguageConfiguration("redis", {
  comments: { lineComment: "#" },
  brackets: [],
  autoClosingPairs: [
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
});

monaco.languages.setMonarchTokensProvider("redis", {
  tokenizer: {
    root: [
      [/^\s*#.*/, "comment"],
      [/^\s*[A-Za-z][A-Za-z0-9_.]*/, "keyword"],
      [/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/, "string"],
      [/\b\d+\b/, "number"],
    ],
  },
});
