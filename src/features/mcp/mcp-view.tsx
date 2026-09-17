import {
  Database,
  History,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { McpAuditSection } from "@/features/mcp/mcp-audit-section";
import { McpClientsSection } from "@/features/mcp/mcp-clients-section";
import { McpConnectionsSection } from "@/features/mcp/mcp-connections-section";
import { McpHeader } from "@/features/mcp/mcp-header";
import { McpLimitsSection } from "@/features/mcp/mcp-limits-section";
import { McpRedactionSection } from "@/features/mcp/mcp-redaction-section";
import { McpSmartGuide } from "@/features/mcp/mcp-smart-guide";
import { McpStatsGrid } from "@/features/mcp/mcp-stats-grid";
import {
  listMcpClients,
  type McpAuditEntry,
  type McpClient,
  type McpConfig,
  type McpConnection,
  mcpAuditTail,
  mcpServerCommand,
  registerMcpClient,
  saveMcpConfig,
  syncMcpConfig,
} from "@/lib/mcp";
import { cn } from "@/lib/utils";

type TabId = "overview" | "connections" | "clients" | "security" | "limits" | "audit";

const TABS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Übersicht", icon: LayoutDashboard },
  { id: "connections", label: "Verbindungen", icon: Database },
  { id: "clients", label: "KI-Clients", icon: Terminal },
  { id: "security", label: "Datenschutz", icon: ShieldCheck },
  { id: "limits", label: "Limits", icon: SlidersHorizontal },
  { id: "audit", label: "Audit-Log", icon: History },
];

export function McpView() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const [command, setCommand] = useState("");
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAudit = useCallback(() => {
    void mcpAuditTail(50)
      .then(setAudit)
      .catch(() => setAudit([]));
  }, []);

  useEffect(() => {
    void syncMcpConfig()
      .then(setConfig)
      .catch((error) => toast.error(String(error)));
    void listMcpClients()
      .then(setClients)
      .catch(() => setClients([]));
    void mcpServerCommand()
      .then(setCommand)
      .catch(() => setCommand(""));
    refreshAudit();
  }, [refreshAudit]);

  const update = (patch: (current: McpConfig) => McpConfig) => {
    setConfig((current) => {
      if (!current) return current;
      const next = patch(current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveMcpConfig(next)
          .then(() => setSaveError(null))
          .catch((error) => setSaveError(String(error)));
      }, 300);
      return next;
    });
  };

  const updateConnection = (id: string, patch: Partial<McpConnection>) => {
    update((current) => ({
      ...current,
      connections: current.connections.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  const toggleClient = async (client: McpClient) => {
    try {
      setClients(await registerMcpClient(client.id, !client.registered));
      toast.success(
        client.registered
          ? `Aus ${client.name} entfernt.`
          : `In ${client.name} eingetragen. Starte die Anwendung neu, damit die Änderungen greifen.`,
      );
    } catch (error) {
      toast.error(String(error));
    }
  };

  if (!config) {
    return (
      <main className="h-full min-h-0 w-full overflow-y-auto p-6 sm:p-8">
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-muted-foreground animate-pulse">
            MCP-Konfiguration wird geladen…
          </p>
        </div>
      </main>
    );
  }

  const exposedCount = config.connections.filter((entry) => entry.exposed).length;
  const registeredClientsCount = clients.filter((c) => c.registered).length;
  const activeRulesCount =
    config.redaction.columns.filter((r) => r.enabled).length +
    config.redaction.values.filter((r) => r.enabled).length;

  const showClientsFirst = registeredClientsCount === 0;

  return (
    <main className="workspace-canvas h-full min-h-0 w-full overflow-y-auto">
      <div className="w-full space-y-6 px-6 py-6 sm:px-8">
        <McpHeader
          enabled={config.enabled}
          exposedCount={exposedCount}
          onToggleEnabled={(enabled) => update((current) => ({ ...current, enabled }))}
        />

        {saveError ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            {saveError}
          </div>
        ) : null}

        <McpSmartGuide
          needsClient={registeredClientsCount === 0}
          needsConnection={exposedCount === 0}
          onGoToClients={() => setActiveTab("clients")}
          onGoToConnections={() => setActiveTab("connections")}
        />

        <McpStatsGrid
          exposedCount={exposedCount}
          totalConnections={config.connections.length}
          registeredClientsCount={registeredClientsCount}
          totalClients={clients.length}
          activeRulesCount={activeRulesCount}
          auditCount={audit.length}
          onSelectTab={(tab) => setActiveTab(tab as TabId)}
        />

        <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-border/80 bg-muted/40 p-1.5 backdrop-blur-sm">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-all shrink-0 cursor-pointer",
                  isActive
                    ? "text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40",
                )}
              >
                {isActive ? (
                  <motion.div
                    layoutId="mcp-tab-indicator"
                    className="absolute inset-0 rounded-xl bg-background border border-border/80"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
                  />
                ) : null}
                <span className="relative z-10 flex items-center gap-2">
                  <Icon className="size-3.5" />
                  {tab.label}
                  {tab.id === "connections" && exposedCount > 0 ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] h-4">
                      {exposedCount}
                    </Badge>
                  ) : null}
                  {tab.id === "clients" && registeredClientsCount > 0 ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] h-4">
                      {registeredClientsCount}
                    </Badge>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "overview" && (
              <div className="space-y-6">
                {showClientsFirst ? (
                  <>
                    <McpClientsSection
                      clients={clients}
                      command={command}
                      isInitialSetup={true}
                      onToggleClient={toggleClient}
                    />
                    <McpConnectionsSection
                      connections={config.connections}
                      isInitialSetup={exposedCount === 0}
                      onUpdateConnection={updateConnection}
                    />
                  </>
                ) : (
                  <>
                    <McpConnectionsSection
                      connections={config.connections}
                      isInitialSetup={exposedCount === 0}
                      onUpdateConnection={updateConnection}
                    />
                    <McpClientsSection
                      clients={clients}
                      command={command}
                      onToggleClient={toggleClient}
                    />
                  </>
                )}
              </div>
            )}

            {activeTab === "connections" && (
              <McpConnectionsSection
                connections={config.connections}
                isInitialSetup={exposedCount === 0}
                onUpdateConnection={updateConnection}
              />
            )}

            {activeTab === "clients" && (
              <McpClientsSection
                clients={clients}
                command={command}
                isInitialSetup={registeredClientsCount === 0}
                onToggleClient={toggleClient}
              />
            )}

            {activeTab === "security" && (
              <McpRedactionSection config={config} onUpdateConfig={update} />
            )}

            {activeTab === "limits" && <McpLimitsSection config={config} onUpdateConfig={update} />}

            {activeTab === "audit" && <McpAuditSection audit={audit} onRefresh={refreshAudit} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}
