import { TriangleAlertIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Spinner } from "@/components/ui/spinner";
import { LiveInfoCard } from "@/features/monitor/live-monitor/live-info-card";
import { TableDataError } from "@/features/table/table-data-error";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useServerInfoQuery } from "@/lib/queries";

const yes = (value: boolean) => (value ? "ja" : "nein");

export function ServerInfoPanel() {
  const { data, isLoading, isError, error, refetch } = useServerInfoQuery();
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("sessions.server-info");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Spinner />
        Lade Verbindungsinfo…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <TableDataError
        title="Verbindungsinfo konnte nicht geladen werden"
        error={error}
        onRetry={() => void refetch()}
      />
    );
  }

  const server: [string, string][] = (
    [
      ["Version", data.version_full ?? data.version],
      ["Benutzer", data.user],
      ["Container", data.container ?? ""],
      ["CDB", data.cdb ?? ""],
      ["Datenbank", data.database ?? ""],
      ["Service", data.service ?? ""],
      ["Instanz", data.instance ?? ""],
      ["Sitzung (SID)", data.sid ?? ""],
      ["Edition", data.edition ?? ""],
      ["Max. Namenslänge", `${data.max_identifier} Byte`],
    ] as [string, string][]
  ).filter(([, value]) => value);
  const access: [string, string][] = [
    ["Rechte und Rollen", data.privileges.join(", ") || "—"],
    ["V$SESSION", yes(data.views.includes("V$SESSION"))],
    ["V$SQL_PLAN", yes(data.views.includes("V$SQL_PLAN"))],
    ["V$LOCK", yes(data.views.includes("V$LOCK"))],
    ["V$SESSION_LONGOPS", yes(data.views.includes("V$SESSION_LONGOPS"))],
    ["DBA-Views", yes(data.views.includes("DBA_OBJECTS"))],
    ["DBMS_TRANSACTION", yes(data.dbms_transaction)],
  ];

  return (
    <div ref={ref} className="flex flex-col gap-4 p-4">
      {isNew && <NewBadge className="self-start" />}
      <div className="grid gap-4 md:grid-cols-2">
        <LiveInfoCard title="Server" rows={server} />
        <LiveInfoCard title="Zugriff" rows={access} />
      </div>
      {data.limits.length > 0 && (
        <ul className="flex flex-col gap-2 text-xs">
          {data.limits.map((limit) => (
            <li
              key={limit}
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
            >
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <span className="select-text">{limit}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
