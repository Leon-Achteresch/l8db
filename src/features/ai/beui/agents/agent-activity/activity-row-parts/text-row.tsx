import type { AgentActivityText } from "../types";

export function TextRow({ item }: { item: AgentActivityText }) {
  return (
    <div className="rounded-md px-1.5 py-1 leading-5 text-muted-foreground">{item.content}</div>
  );
}
