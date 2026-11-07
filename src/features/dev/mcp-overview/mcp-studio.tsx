import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { LabDatabase, McpLabState } from "./data";
import { McpStudioClients } from "./mcp-studio-clients";
import { McpStudioCore } from "./mcp-studio-core";
import { McpStudioDatabases } from "./mcp-studio-databases";
import { McpStudioLog } from "./mcp-studio-log";
import { McpStudioSettings } from "./mcp-studio-settings";

interface McpStudioProps {
  state: McpLabState;
  setState: Dispatch<SetStateAction<McpLabState>>;
}

export function McpStudio({ state, setState }: McpStudioProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const database = state.databases.find((entry) => entry.id === selected) ?? null;
  const kindByName = new Map(state.databases.map((entry) => [entry.name, entry.kind]));
  const calls = database
    ? state.calls.filter((call) => call.connection === database.name)
    : state.calls;

  const patchDatabases = (ids: string[], patch: Partial<LabDatabase>) =>
    setState((current) => ({
      ...current,
      databases: current.databases.map((entry) =>
        ids.includes(entry.id) ? { ...entry, ...patch } : entry,
      ),
    }));

  return (
    <div className="space-y-14">
      <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto_1.2fr]">
        <McpStudioClients
          clients={state.clients}
          onToggle={(id) =>
            setState((current) => ({
              ...current,
              clients: current.clients.map((client) =>
                client.id === id ? { ...client, registered: !client.registered } : client,
              ),
            }))
          }
        />
        <McpStudioCore
          enabled={state.enabled}
          onToggle={() => setState((current) => ({ ...current, enabled: !current.enabled }))}
        />
        <McpStudioDatabases
          databases={state.databases}
          selected={selected}
          onSelect={setSelected}
          onExpose={(ids, exposed) => patchDatabases(ids, { exposed })}
        />
      </div>
      <div className="grid gap-10 lg:grid-cols-[18rem_1fr]">
        <McpStudioSettings
          database={database}
          limits={state.limits}
          workflows={state.workflows}
          maskRules={state.maskRules}
          onDatabase={(patch) => database && patchDatabases([database.id], patch)}
          onLimits={(patch) =>
            setState((current) => ({ ...current, limits: { ...current.limits, ...patch } }))
          }
          onWorkflows={(workflows) => setState((current) => ({ ...current, workflows }))}
          onClose={() => setSelected(null)}
        />
        <McpStudioLog key={selected ?? "all"} calls={calls} kindByName={kindByName} />
      </div>
    </div>
  );
}
