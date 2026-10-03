import { AgentCode } from "@/features/ai/beui/agents/agent-code";
import { cn } from "@/lib/utils";
import type { ToolResultOutputProps } from "./shared";

export function ToolResultOutput({
  children,
  language = "bash",
  className,
}: ToolResultOutputProps) {
  return (
    <AgentCode
      code={children}
      language={language}
      className={cn("whitespace-pre-wrap break-words text-foreground/80", className)}
    />
  );
}
