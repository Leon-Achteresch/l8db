import { Database, History, ShieldCheck, Terminal } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { McpVariantProps } from "./data";

export function McpNumbersVariant({ state, onToggleDatabase }: McpVariantProps) {
  const exposed = state.databases.filter((db) => db.exposed).length;
  const clients = state.clients.filter((client) => client.registered).length;
  const tiles = [
    { icon: Database, value: `${exposed}/${state.databases.length}`, label: "Datenbanken" },
    { icon: Terminal, value: `${clients}/${state.clients.length}`, label: "Clients" },
    { icon: ShieldCheck, value: state.maskRules, label: "Masken" },
    { icon: History, value: state.calls.length, label: "Aufrufe" },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(({ icon: Icon, value, label }) => (
          <div key={label} className="rounded-2xl bg-muted/50 p-4">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            <div className="mt-6 text-2xl font-semibold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {state.databases.map((db) => (
          <div
            key={db.id}
            className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted/50"
          >
            <ProviderLogo kind={db.kind} className="size-4" />
            <span className={cn("flex-1", !db.exposed && "text-muted-foreground")}>{db.name}</span>
            {db.environment === "production" && (
              <span className="size-1.5 rounded-full bg-amber-500" title="Produktion" />
            )}
            <Switch
              checked={db.exposed}
              onCheckedChange={() => onToggleDatabase(db.id)}
              aria-label={db.name}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
