import * as monaco from "monaco-editor/editor/editor.api";
import {
  conf as javascriptConf,
  language as javascriptLanguage,
} from "monaco-editor/languages/definitions/javascript/javascript";
import {
  conf as sqlConf,
  language as sqlLanguage,
} from "monaco-editor/languages/definitions/sql/sql";
import { redisCommandMatches } from "@/lib/redis-command-names";

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

monaco.languages.register({ id: "mongodb" });

monaco.languages.setLanguageConfiguration("mongodb", javascriptConf);

monaco.languages.setMonarchTokensProvider("mongodb", javascriptLanguage);

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

monaco.languages.registerCompletionItemProvider("redis", {
  provideCompletionItems(model, position) {
    const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    return {
      suggestions: redisCommandMatches(line).map((name) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: name,
        range,
      })),
    };
  },
});
