import { useEffect, useState } from "react";
import { create } from "zustand";
import { type HostGroupRule, matchingHostRule } from "@/lib/connection-groups";
import type { ConnectionEnvironment, SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections/store";
import { useSettingsStore } from "@/lib/settings";
import { writesData } from "@/lib/sql-safety";

export interface EnvironmentInfo {
  value: ConnectionEnvironment;
  label: string;
  color: string;
}

export const ENVIRONMENTS: EnvironmentInfo[] = [
  { value: "development", label: "Entwicklung", color: "#22c55e" },
  { value: "test", label: "Test", color: "#3b82f6" },
  { value: "staging", label: "Staging", color: "#f97316" },
  { value: "production", label: "Produktion", color: "#ef4444" },
];

export const WRITE_MODE_MINUTES = 15;

export const PRODUCTION_LOCK_MESSAGE =
  "Produktion ist schreibgeschützt. Schreibmodus für 15 Minuten aktivieren, um Änderungen auszuführen.";

type EnvironmentTarget = Pick<SavedConnection, "connectionString" | "kind"> & {
  environment?: ConnectionEnvironment | null;
};

export function environmentInfo(
  environment: ConnectionEnvironment | null | undefined,
): EnvironmentInfo | null {
  return ENVIRONMENTS.find((entry) => entry.value === environment) ?? null;
}

export function connectionEnvironment(
  connection: EnvironmentTarget | null | undefined,
  rules: HostGroupRule[] = useConnectionsStore.getState().hostGroupRules,
): ConnectionEnvironment | null {
  if (!connection) return null;
  if (connection.environment) return connection.environment;
  const envRules = rules.filter((rule) => rule.environment);
  if (!envRules.length) return null;
  try {
    return matchingHostRule(connection, envRules)?.environment ?? null;
  } catch {
    return null;
  }
}

export function isProduction(connection: EnvironmentTarget | null | undefined): boolean {
  return connectionEnvironment(connection) === "production";
}

interface WriteModeState {
  unlockedUntil: Record<string, number>;
  unlock: (id: string, minutes?: number) => void;
  lock: (id: string) => void;
}

export const useWriteModeStore = create<WriteModeState>((set) => ({
  unlockedUntil: {},
  unlock: (id, minutes = WRITE_MODE_MINUTES) =>
    set((state) => ({
      unlockedUntil: { ...state.unlockedUntil, [id]: Date.now() + minutes * 60_000 },
    })),
  lock: (id) =>
    set((state) => {
      const next = { ...state.unlockedUntil };
      delete next[id];
      return { unlockedUntil: next };
    }),
}));

export function writeModeUntil(id: string, now = Date.now()): number | null {
  const until = useWriteModeStore.getState().unlockedUntil[id];
  return until && until > now ? until : null;
}

export function isProductionLocked(
  connection: (EnvironmentTarget & { id: string }) | null | undefined,
): boolean {
  if (!connection || !isProduction(connection)) return false;
  if (!useSettingsStore.getState().productionReadOnly) return false;
  return writeModeUntil(connection.id) === null;
}

export function productionWriteBlock(
  connection: (EnvironmentTarget & { id: string }) | null | undefined,
  sql: string | null,
): string | null {
  if (!isProductionLocked(connection)) return null;
  if (sql !== null && !writesData(sql, connection?.kind)) return null;
  return PRODUCTION_LOCK_MESSAGE;
}

export function productionConfirmTexts(
  connection: Pick<SavedConnection, "name"> | null | undefined,
  database?: string | null,
): string[] {
  return [connection?.name, database].filter((entry): entry is string => Boolean(entry?.trim()));
}

export function useConnectionEnvironment(
  connection: EnvironmentTarget | null | undefined,
): EnvironmentInfo | null {
  const rules = useConnectionsStore((state) => state.hostGroupRules);
  return environmentInfo(connectionEnvironment(connection, rules));
}

export function useWriteModeRemaining(id: string | null | undefined): number | null {
  const until = useWriteModeStore((state) => (id ? state.unlockedUntil[id] : undefined));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [until]);
  return until && until > now ? until - now : null;
}
