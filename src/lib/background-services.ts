import { initAiActivity } from "@/lib/automation/ai-activity";
import { initAutomationSync } from "@/lib/automation/sync";
import { initCliPathCheck } from "@/lib/cli-path";
import { initMcpDashboardSync } from "@/lib/dashboards/mcp-sync";
import { initMcpSync } from "@/lib/mcp";
import { initMcpOpen } from "@/lib/mcp-open";

export function startBackgroundServices(main: boolean) {
  const services = [initMcpDashboardSync, initMcpSync, initAutomationSync, initAiActivity];
  if (main) services.push(initMcpOpen);
  services.push(() => initCliPathCheck(main && !import.meta.env.DEV));
  for (const start of services) {
    try {
      start();
    } catch {}
  }
}
