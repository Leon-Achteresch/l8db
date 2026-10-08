import {
  formatUsageCount,
  formatUsageLatency,
  type UsageStatisticsSummary,
} from "@/features/settings/usage-statistics-format";
import {
  durationPercentile,
  type UsageStatistics,
  usageOperationLabel,
} from "@/lib/usage-statistics";

interface Props {
  summary: UsageStatisticsSummary;
  startup: UsageStatistics["startup"];
}

export function SettingsUsageOperations({ summary, startup }: Props) {
  return (
    <section className="rounded-xl border p-4" aria-labelledby="usage-operations-heading">
      <h3 id="usage-operations-heading" className="text-sm font-medium">
        Vorgänge & Wartezeiten
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {formatUsageCount(summary.successful)} erfolgreich · {formatUsageCount(summary.errors)}{" "}
        fehlgeschlagen · {formatUsageCount(summary.cancelled)} abgebrochen. Die 16 häufigsten
        Vorgänge nach Datenbanktyp. Editorabfragen und einzelne SQL-Befehle werden getrennt gezählt.
        p50 und p95 sind Näherungen aus Zeitklassen; p95 beschreibt die Grenze für 95 % der
        erfassten Vorgänge.
      </p>
      {summary.operations.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Noch keine Datenbankvorgänge erfasst. Öffne eine Verbindung oder führe eine Abfrage aus.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <caption className="sr-only">
              Häufigste Datenbankvorgänge mit Ergebnissen und Dauer
            </caption>
            <thead className="border-b text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  Vorgang
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Typ
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Erfolg
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Fehler
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Abbruch
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  ~ p50
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  ~ p95
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.operations.map((operation) => (
                <tr
                  key={`${operation.operation}:${operation.kind}`}
                  className="border-b last:border-0"
                >
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {usageOperationLabel(operation.operation)}
                  </th>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {operation.kind.toUpperCase()}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatUsageCount(operation.ok)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatUsageCount(operation.error)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatUsageCount(operation.cancelled)}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {formatUsageLatency(durationPercentile(operation.histogram, 0.5))}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {formatUsageLatency(durationPercentile(operation.histogram, 0.95))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 border-t pt-3 text-xs">
        <p className="font-medium">App-Start</p>
        <p className="mt-1 tabular-nums text-muted-foreground">
          {formatUsageCount(startup.count)} Messungen · ~ p50{" "}
          {formatUsageLatency(durationPercentile(startup.histogram, 0.5))} · ~ p95{" "}
          {formatUsageLatency(durationPercentile(startup.histogram, 0.95))}
        </p>
      </div>
    </section>
  );
}
