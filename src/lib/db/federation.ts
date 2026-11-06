import { cancelExecution, invoke, type QueryExecutionOptions } from "./core";
import type { FederationCatalog, FederationReport, FederationSource } from "./federation-types";

export * from "./federation-types";

async function federationJob<T>(
  command: "federation_query" | "federation_catalog",
  args: Record<string, unknown>,
  options?: QueryExecutionOptions,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Error("Datenbankübergreifende Abfrage wurde abgebrochen.");
  const jobId = options?.jobId ?? crypto.randomUUID();
  let started = false;
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    if (started) void cancelExecution(jobId).catch(() => {});
    rejectAbort(new Error("Datenbankübergreifende Abfrage wurde abgebrochen."));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const synced = import("@/lib/automation/sync").then(({ syncAutomationConnectionsNow }) =>
      syncAutomationConnectionsNow(),
    );
    await Promise.race([synced, aborted]);
    if (signal?.aborted) throw new Error("Datenbankübergreifende Abfrage wurde abgebrochen.");
    started = true;
    return await Promise.race([
      invoke<T>(command, { ...args, options: { ...options, jobId } }),
      aborted,
    ]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export function federationCatalog(
  connectionId: string,
  database?: string | null,
  schema?: string,
  signal?: AbortSignal,
): Promise<FederationCatalog> {
  return federationJob(
    "federation_catalog",
    {
      connectionId,
      database: database || undefined,
      schema: schema || undefined,
    },
    { queryTimeout: 20 },
    signal,
  );
}

export function queryFederation(
  sources: FederationSource[],
  sql: string,
  options?: QueryExecutionOptions,
  signal?: AbortSignal,
): Promise<FederationReport> {
  return federationJob("federation_query", { request: { sources, sql } }, options, signal);
}
