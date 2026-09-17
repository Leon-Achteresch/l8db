import { Database, History, ShieldCheck, Terminal } from "lucide-react";
import { motion } from "motion/react";
import { McpStatCard } from "@/features/mcp/mcp-stat-card";

interface McpStatsGridProps {
  exposedCount: number;
  totalConnections: number;
  registeredClientsCount: number;
  totalClients: number;
  activeRulesCount: number;
  auditCount: number;
  onSelectTab: (tab: string) => void;
}

export function McpStatsGrid({
  exposedCount,
  totalConnections,
  registeredClientsCount,
  totalClients,
  activeRulesCount,
  auditCount,
  onSelectTab,
}: McpStatsGridProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      <McpStatCard
        icon={Database}
        label="Freigegebene Datenbanken"
        value={`${exposedCount} / ${totalConnections}`}
        subtext={exposedCount > 0 ? "Bereit für KI-Abfragen" : "Keine Datenbank freigegeben"}
        status={exposedCount > 0 ? "active" : "warning"}
        onClick={() => onSelectTab("connections")}
      />
      <McpStatCard
        icon={Terminal}
        label="Registrierte CLIs"
        value={`${registeredClientsCount} / ${totalClients}`}
        subtext={registeredClientsCount > 0 ? "Tools konfiguriert" : "Noch nicht eingerichtet"}
        status={registeredClientsCount > 0 ? "active" : "warning"}
        onClick={() => onSelectTab("clients")}
      />
      <McpStatCard
        icon={ShieldCheck}
        label="Maskierungsregeln"
        value={activeRulesCount}
        subtext="Schutz vor Datenlecks"
        status={activeRulesCount > 0 ? "active" : "default"}
        onClick={() => onSelectTab("security")}
      />
      <McpStatCard
        icon={History}
        label="Audit-Einträge"
        value={auditCount}
        subtext="Protokollierte Aufrufe"
        status="default"
        onClick={() => onSelectTab("audit")}
      />
    </motion.div>
  );
}
