import { createFileRoute } from "@tanstack/react-router";

import { McpView } from "@/features/mcp/mcp-view";

export const Route = createFileRoute("/mcp")({
  component: McpView,
});
