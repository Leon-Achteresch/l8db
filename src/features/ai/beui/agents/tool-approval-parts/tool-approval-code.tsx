import { AgentCode } from "@/features/ai/beui/agents/agent-code";
import { cn } from "@/lib/utils";
import type { ToolApprovalCodeProps } from "./shared";

export function ToolApprovalCode({ code, language = "bash", className }: ToolApprovalCodeProps) {
  return (
    <AgentCode
      code={code}
      language={language}
      className={cn(
        "whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2",
        className,
      )}
    />
  );
}
