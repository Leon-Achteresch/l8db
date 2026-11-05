import { useState } from "react";
import {
  LAB_CALLS,
  LAB_CLIENTS,
  LAB_DATABASES,
  LAB_LIMITS,
  type McpLabState,
} from "./mcp-overview/data";
import { McpActivityVariant } from "./mcp-overview/mcp-activity-variant";
import { McpFlowVariant } from "./mcp-overview/mcp-flow-variant";
import { McpNumbersVariant } from "./mcp-overview/mcp-numbers-variant";
import { McpPulseVariant } from "./mcp-overview/mcp-pulse-variant";
import { McpStudio } from "./mcp-overview/mcp-studio";

const variants = [
  { id: "pulse", title: "Puls", View: McpPulseVariant },
  { id: "flow", title: "Fluss", View: McpFlowVariant },
  { id: "activity", title: "Aktivität", View: McpActivityVariant },
  { id: "numbers", title: "Kacheln", View: McpNumbersVariant },
] as const;

const initial: McpLabState = {
  enabled: true,
  databases: LAB_DATABASES,
  clients: LAB_CLIENTS,
  calls: LAB_CALLS,
  maskRules: 4,
  limits: LAB_LIMITS,
  workflows: true,
};

export function McpOverviewLab() {
  const [state, setState] = useState(initial);
  const onToggleServer = () => setState((current) => ({ ...current, enabled: !current.enabled }));
  const onToggleDatabase = (id: string) =>
    setState((current) => ({
      ...current,
      databases: current.databases.map((db) =>
        db.id === id ? { ...db, exposed: !db.exposed } : db,
      ),
    }));
  return (
    <div className="space-y-12">
      <McpStudio state={state} setState={setState} />
      <h3 className="pt-6 text-xs font-medium tracking-widest text-muted-foreground">ENTWÜRFE</h3>
      {variants.map(({ id, title, View }, index) => (
        <section key={id} aria-labelledby={`mcp-${id}`} className="space-y-3">
          <h3 id={`mcp-${id}`} className="flex items-baseline gap-3 text-sm font-semibold">
            <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
            {title}
          </h3>
          <div className="rounded-2xl bg-sidebar/45 p-6">
            <View
              state={state}
              onToggleServer={onToggleServer}
              onToggleDatabase={onToggleDatabase}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
