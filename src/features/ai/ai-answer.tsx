import { aiFollowups } from "@/lib/ai/result";
import { AiFollowups } from "./ai-followups";
import { AiMarkdown } from "./ai-markdown";
import type { AgentCodeLanguage } from "./beui/agents/agent-code";
import { CodeBlock } from "./beui/agents/code-block";
import { StreamingResponse } from "./beui/agents/streaming-response";

export function AiAnswer({
  text,
  streaming,
  onFollowup,
}: {
  text: string;
  streaming: boolean;
  onFollowup?: (question: string) => void;
}) {
  const parts = text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g);
  return (
    <StreamingResponse
      status={streaming ? "streaming" : "complete"}
      announce={false}
      showActions={false}
      className="text-sm"
      contentClassName="text-sm leading-relaxed"
    >
      {parts.map((part, index) => {
        if (!part.startsWith("```"))
          return part ? <AiMarkdown key={String(index)} source={part} /> : null;
        const newline = part.indexOf("\n");
        const language = part.slice(3, newline).trim();
        const code = part
          .slice(newline + 1)
          .replace(/```$/, "")
          .replace(/\n$/, "");
        if (language === "followups")
          return onFollowup && part.endsWith("```") ? (
            <AiFollowups key={String(index)} questions={aiFollowups(code)} onAsk={onFollowup} />
          ) : null;
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
            className="my-2 rounded-lg border border-border/70 bg-secondary"
            code={code}
            language={
              supported.includes(language as AgentCodeLanguage)
                ? (language as AgentCodeLanguage)
                : "text"
            }
            status={streaming && !part.endsWith("```") ? "streaming" : "complete"}
            showLineNumbers={false}
            maxHeight={320}
          />
        );
      })}
    </StreamingResponse>
  );
}
