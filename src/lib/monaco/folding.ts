import * as monaco from "monaco-editor/editor/editor.api";
import { sqlFoldingRanges } from "@/lib/sql-folding";

const KIND = {
  block: undefined,
  comment: monaco.languages.FoldingRangeKind.Comment,
  region: monaco.languages.FoldingRangeKind.Region,
};

for (const language of ["sql", "plsql"]) {
  monaco.languages.registerFoldingRangeProvider(language, {
    provideFoldingRanges: (model) =>
      sqlFoldingRanges(model.getValue()).map((range) => ({
        start: range.start,
        end: range.end,
        kind: KIND[range.kind],
      })),
  });
}
