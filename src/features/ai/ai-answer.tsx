import { Markdown } from "@/components/markdown";
import type { AgentCodeLanguage } from "./beui/agents/agent-code";
import { CodeBlock } from "./beui/agents/code-block";
import { StreamingResponse } from "./beui/agents/streaming-response";

export function AiAnswer({ text, streaming }: { text: string; streaming: boolean }) {
  const parts = text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g);
  return (
    <StreamingResponse
      status={streaming ? "streaming" : "complete"}
      copyText={text}
      announce={false}
      showActions={!streaming && Boolean(text)}
      className="text-xs"
      contentClassName="text-xs leading-relaxed"
    >
      {parts.map((part, index) => {
        if (!part.startsWith("```"))
          return part ? (
            <Markdown key={String(index)} source={part} className="text-xs text-foreground" />
          ) : null;
        const newline = part.indexOf("\n");
        const language = part.slice(3, newline).trim();
        const code = part.slice(newline + 1).replace(/```$/, "");
        const supported: AgentCodeLanguage[] = [
          "bash",
          "diff",
          "json",
          "text",
          "tsx",
          "typescript",
          "sql",
        ];
        return (
          <CodeBlock
            key={String(index)}
            code={code}
            language={
              supported.includes(language as AgentCodeLanguage)
                ? (language as AgentCodeLanguage)
                : "text"
            }
            status={streaming && !part.endsWith("```") ? "streaming" : "complete"}
            maxHeight={320}
          />
        );
      })}
    </StreamingResponse>
  );
}
