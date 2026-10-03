import type { AgentActivityItem } from "../types";

import { SearchRow } from "./search-row";
import { StepRow } from "./step-row";
import { TextRow } from "./text-row";
import { ToolRow } from "./tool-row";
import { TraceRow } from "./trace-row";

export function ActivityRow({ item }: { item: AgentActivityItem }) {
  if (item.type === "text") return <TextRow item={item} />;
  if (item.type === "search") return <SearchRow item={item} />;
  if (item.type === "tool") return <ToolRow item={item} />;
  if (item.type === "trace") return <TraceRow item={item} />;
  return <StepRow item={item} />;
}
