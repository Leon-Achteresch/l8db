export type MonitorTab =
  | "live"
  | "sessions"
  | "connections"
  | "resources"
  | "locks"
  | "io"
  | "replication"
  | "logs"
  | "performance"
  | "workload";
export type HistoryRange = "all" | "24h" | "7d";
export type HistoryFilter = "all" | "success" | "error";
