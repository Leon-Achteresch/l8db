import { Check, Database, History, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { McpAuditRow } from "@/features/mcp/mcp-audit-row";
import { McpStatCard } from "@/features/mcp/mcp-stat-card";
import { AI_LAB_AUDIT } from "./ai-lab-data";

export function AiLabMcp() {
  const id = useId();
  const [exposed, setExposed] = useState(true);
  const [connected, setConnected] = useState(false);
  const [tested, setTested] = useState(false);

  return (
    <section aria-label="MCP-Designvorschau" className="h-full space-y-6 overflow-auto p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge variant="outline">Werkzeuge für KI-Assistenten</Badge>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight">MCP-Verbindungen</h3>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Freigaben, Erreichbarkeit und Nutzung auf einen Blick.
          </p>
        </div>
        <Button size="sm" onClick={() => setTested(true)}>
          <ShieldCheck className="size-3.5" /> Diagnose simulieren
        </Button>
      </div>
      {tested && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border bg-primary/5 px-4 py-3 text-xs"
        >
          <Check className="size-4 text-primary" /> Beispiel: Prozessstart, Handshake und
          Werkzeugliste geprüft. Keine echte Verbindung.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <McpStatCard
          icon={Database}
          label="Freigegebene Datenbanken"
          value={exposed ? "2 / 4" : "1 / 4"}
          subtext="Leserechte je Verbindung"
          status="active"
        />
        <McpStatCard
          icon={Plug}
          label="Client-Konfiguration"
          value="2 registriert"
          subtext="Registriert bedeutet nicht erreichbar"
        />
        <McpStatCard
          icon={History}
          label="Letzter Verbindungstest"
          value={tested ? "Simuliert" : "Nicht geprüft"}
          subtext="Diagnose nur auf Anforderung"
          status={tested ? "active" : "warning"}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h4 className="text-sm font-medium">Datenbank-Freigaben</h4>
          <div className="flex items-center justify-between gap-4 border-b pb-4">
            <div>
              <label htmlFor={`${id}-shop`} className="text-xs font-medium">
                Shop · Staging
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">
                PostgreSQL · public · nur lesen
              </p>
            </div>
            <Switch id={`${id}-shop`} checked={exposed} onCheckedChange={setExposed} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>Analytics · DuckDB</span>
            <Badge variant="secondary">Lesen</Badge>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Produktion</span>
            <Badge variant="outline">Nicht freigegeben</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            6 Maskierungsregeln · Beispielkonfiguration
          </p>
        </div>
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h4 className="text-sm font-medium">Externe Server im Chat</h4>
          <div className="flex items-center justify-between text-xs">
            <span>Dokumentation</span>
            <Badge variant="secondary">8 Werkzeuge</Badge>
          </div>
          <div className="flex items-center justify-between border-t pt-4 text-xs">
            <span>Tickets</span>
            <Badge variant={connected ? "secondary" : "outline"}>
              {connected ? "Erreichbar · Beispiel" : "Nicht erreichbar"}
            </Badge>
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            {connected
              ? "Die Werkzeuge stehen in der Vorschau wieder zur Verfügung."
              : "Beispiel: Zeitlimit überschritten. Andere Werkzeuge bleiben verwendbar."}
          </p>
          <Button size="sm" variant="outline" onClick={() => setConnected(!connected)}>
            <RefreshCw className="size-3.5" />{" "}
            {connected ? "Ausfall simulieren" : "Neu verbinden simulieren"}
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Letzte Aufrufe{" "}
          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
            Beispieldaten · keine automatische Aktualisierung
          </span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left">
            <thead className="bg-muted/30 text-[10px] text-muted-foreground">
              <tr>
                {["Zeitpunkt", "Verbindung", "Tool", "Befehl", "Dauer", "Status"].map((label) => (
                  <th key={label} className="px-3.5 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AI_LAB_AUDIT.map((entry) => (
                <McpAuditRow key={entry.ts} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
