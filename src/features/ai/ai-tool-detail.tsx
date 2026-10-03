import { useMemo } from "react";
import { aiRowsLabel, parseAiTable } from "@/lib/ai/result";
import type { AiRichBlock } from "@/lib/ai/rich";
import { AiResultActions } from "./ai-result-actions";
import { AiResultTable } from "./ai-result-table";

type ToolBlock = Extract<AiRichBlock, { type: "tool" }>;

export function AiToolDetail({ block }: { block: ToolBlock }) {
  const table = useMemo(() => parseAiTable(block.output), [block.output]);
  return (
    <div className="space-y-1.5">
      {(block.sql || table) && (
        <div className="flex items-start gap-2 rounded-md bg-muted/40 py-1 pr-1 pl-3">
          {block.sql ? (
            <pre className="min-w-0 flex-1 overflow-auto whitespace-pre-wrap py-1 font-mono text-[11px] text-foreground/80">
              {block.sql}
            </pre>
          ) : (
            <span className="flex-1" />
          )}
          <AiResultActions table={table} sql={block.sql} title={block.title || block.name} />
        </div>
      )}
      {table ? (
        <div className="overflow-hidden rounded-md border">
          <AiResultTable table={table} />
          <p className="border-t px-2.5 py-1 text-[11px] text-muted-foreground">
            {aiRowsLabel(table.footer)}
          </p>
        </div>
      ) : (
        block.output && (
          <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground/80">
            {block.output}
          </div>
        )
      )}
    </div>
  );
}
