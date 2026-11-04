import { githubIssueUrl } from "@/lib/ai/issue-presentation";
import type { AiRichBlock } from "@/lib/ai/rich";
import { AiIssueCard } from "./ai-issue-card";

export function AiIssueResult({
  block,
  running,
}: {
  block: Extract<AiRichBlock, { type: "tool" }>;
  running: boolean;
}) {
  const status = block.status === "running" && !running ? "cancelled" : block.status;
  const url = status === "success" ? githubIssueUrl(block.output) : undefined;
  return (
    <AiIssueCard
      title={block.title || "Fehlerbericht"}
      body={block.body || block.output}
      status={status === "running" || status === "cancelled" ? status : url ? "success" : "error"}
      url={url}
      error={
        status === "error" || (status === "success" && !url)
          ? block.output || "Der Dienst hat keinen gültigen Issue-Link geliefert."
          : undefined
      }
    />
  );
}
