import { parseAiDiff } from "@/lib/ai/diff";
import type { AiRichBlock } from "@/lib/ai/rich";
import { useSettingsStore } from "@/lib/settings";
import { FileDiff } from "./beui/agents/file-diff";
import { ImageGeneration } from "./beui/agents/image-generation";
import { TodoList } from "./beui/agents/todo-list";
import { ToolResult, ToolResultOutput } from "./beui/agents/tool-result";

export function AiRichContent({ blocks, running }: { blocks: AiRichBlock[]; running: boolean }) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const tools = blocks.filter((block) => block.type === "tool");
  const results = tools.map((tool) => (
    <ToolResult
      key={tool.id}
      tool={tool.name}
      title={tool.name}
      status={
        tool.status === "running" && !running
          ? "cancelled"
          : (tool.status as "running" | "success" | "error" | "cancelled")
      }
      kind="request"
      defaultOpen={false}
      maxHeight={280}
      copyText={tool.output}
    >
      {tool.output ? (
        <ToolResultOutput language="text">{tool.output}</ToolResultOutput>
      ) : (
        <p className="text-xs text-muted-foreground">Keine Textausgabe gemeldet.</p>
      )}
    </ToolResult>
  ));
  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        if (block.type === "plan")
          return (
            <TodoList
              key={block.id}
              items={block.items}
              title="Plan des Agents"
              defaultOpen={false}
              collapseOnComplete
              className="text-xs"
            />
          );
        if (block.type === "diff")
          return (
            <FileDiff
              key={block.id}
              file={block.path}
              lines={parseAiDiff(block.diff, block.id)}
              copyText={block.diff}
              defaultOpen={false}
              maxHeight={280}
              status="complete"
            />
          );
        if (block.type === "image")
          return (
            <ImageGeneration
              key={block.id}
              label={block.label}
              status={block.status === "generating" && !running ? "error" : block.status}
              statusText={
                block.src
                  ? "Bild bereit"
                  : block.status === "error"
                    ? "Bildgenerierung fehlgeschlagen"
                    : "Bild-Ergebnis ohne Vorschau"
              }
              size="fluid"
              interactive={false}
              className="max-w-sm"
            >
              {block.src && (
                <img src={block.src} alt={block.label} className="h-full w-full object-contain" />
              )}
            </ImageGeneration>
          );
        if (block.type === "decision")
          return (
            <p
              key={block.id}
              className="rounded-lg border px-3 py-2 text-[11px] text-muted-foreground"
            >
              {block.title} ·{" "}
              {block.outcome === "allowed"
                ? "Einmal erlaubt"
                : block.outcome === "denied"
                  ? "Abgelehnt"
                  : "Beantwortet"}
            </p>
          );
        return null;
      })}
      {tools.length > 0 &&
        (easyMode ? (
          <details className="group/tools text-xs">
            <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md text-muted-foreground hover:text-foreground">
              {tools.length} {tools.length === 1 ? "Tool verwendet" : "Tools verwendet"}
              <span aria-hidden="true" className="transition-transform group-open/tools:rotate-90">
                ›
              </span>
            </summary>
            <div className="mt-2 space-y-2">{results}</div>
          </details>
        ) : (
          <div className="space-y-2">{results}</div>
        ))}
    </div>
  );
}
