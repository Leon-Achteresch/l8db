import type { DatabaseKind, QueryResult } from "@/lib/db";

export interface QueryResultTiming extends QueryResult {
  timingScope?: "adapter_query_result" | "not_measured";
}

export function withAdapterResultTiming(
  result: QueryResult,
  kind?: DatabaseKind,
): QueryResultTiming {
  const timed: QueryResultTiming = { ...result };
  if (kind === "postgres" || kind === "mysql") timed.timingScope = "adapter_query_result";
  else delete timed.timingScope;
  return timed;
}

export function withoutMeasuredQueryTiming(result: QueryResult): QueryResultTiming {
  return { ...result, timingScope: "not_measured" };
}

export function queryDurationText(result: QueryResultTiming): string {
  if (result.timingScope === "not_measured") return "Nicht gemessen";
  const duration = `${result.execution_time_ms} ms`;
  return result.timingScope === "adapter_query_result"
    ? `${duration} inkl. Ergebnisübernahme`
    : `${duration} (Messumfang unbekannt)`;
}

export function queryTimingDescription(result: QueryResultTiming): string {
  if (result.timingScope === "not_measured")
    return "Für diesen Sitzungsview-Schritt wurde keine Abfragedauer gemessen. Der Zeitwert 0 ist hier ein Platzhalter, keine gemessene Datenbanklaufzeit.";
  if (result.timingScope === "adapter_query_result")
    return "Adapterzeit vom Abfragestart beziehungsweise der Vorbereitung bis zur Übernahme und zum Aufbau der Ergebnisdaten. Enthält Serverarbeit und Ergebnistransport, ist also keine reine Serverzeit. Verbindungsaufbau, spätere Nacharbeiten, Übergabe an die Oberfläche und Darstellung sind nicht enthalten; dies ist nicht die gesamte Wartezeit.";
  return "Für diesen Zeitwert ist die Messgrenze nicht belegt. Er wird unverändert angezeigt und lässt keine verlässliche Aussage über reine Serverzeit, Transportzeit oder gesamte Warte- und Darstellungszeit zu.";
}
