import { initAiActivity } from "@/lib/automation/ai-activity";
import { initAutomationSync } from "@/lib/automation/sync";
import { initMcpDashboardSync } from "@/lib/dashboards/mcp-sync";
import { initMcpSync } from "@/lib/mcp";
import { initMcpOpen } from "@/lib/mcp-open";

export function startBackgroundServices(main: boolean) {
  const services = [initMcpDashboardSync, initMcpSync, initAutomationSync, initAiActivity];
  if (main) services.push(initMcpOpen);
  for (const start of services) {
    try {
      start();
    } catch {}
  }
}
