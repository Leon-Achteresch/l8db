import type { LiveMetrics } from "../../src/lib/db";

export function liveMetrics(overrides: Partial<LiveMetrics> = {}): LiveMetrics {
  return {
    connections: 18,
    max_connections: 100,
    active_sessions: 12,
    waiting_locks: 3,
    database_size_bytes: null,
    commits: 0,
    rollbacks: 0,
    queries_read: 0,
    queries_write: 0,
    queries_other: 0,
    rows_read: 0,
    rows_written: 0,
    blocks_read: 0,
    blocks_hit: 0,
    temp_bytes: 0,
    deadlocks: 0,
    cpu_busy: null,
    cpu_total: null,
    server_version: "18.0",
    uptime_seconds: 100,
    timezone: "Europe/Berlin",
    default_isolation: "read committed",
    in_recovery: false,
    replay_delay_ms: null,
    replication: [],
    table_io: [],
    ...overrides,
  };
}
