import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ConvexStudioTarget,
  convexStudioFunctionsStats,
} from "@/lib/db/convex-studio-functions";

const WINDOWS = [
  { minutes: 60, label: "Letzte Stunde" },
  { minutes: 360, label: "Letzte 6 Stunden" },
  { minutes: 1440, label: "Letzte 24 Stunden" },
  { minutes: 10080, label: "Letzte 7 Tage" },
];

const formatMs = (value: number | null) => (value == null ? "–" : `${value} ms`);

export function ConvexFunctionStats({
  target,
  deploymentKey,
  identifier,
}: {
  target: ConvexStudioTarget;
  deploymentKey: string;
  identifier: string;
}) {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const stats = useQuery({
    queryKey: [
      "convex",
      target.id,
      "functions",
      deploymentKey,
      "function-stats",
      identifier,
      windowMinutes,
    ],
    queryFn: () => convexStudioFunctionsStats(target, identifier, windowMinutes),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const data = stats.data;
  const peak = Math.max(1, ...(data?.buckets.map((bucket) => bucket.invocations) ?? []));
  const tiles = data
    ? [
        { label: "Aufrufe", value: data.invocations.toLocaleString("de-DE") },
        {
          label: "Fehler",
          value: `${data.errors.toLocaleString("de-DE")}${data.invocations > 0 ? ` (${((data.errors / data.invocations) * 100).toFixed(1)} %)` : ""}`,
        },
        { label: "p50 (≈)", value: formatMs(data.p50Ms) },
        { label: "p95 (≈)", value: formatMs(data.p95Ms) },
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(windowMinutes)}
          onValueChange={(value) => setWindowMinutes(Number(value))}
        >
          <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label="Zeitraum">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((item) => (
              <SelectItem key={item.minutes} value={String(item.minutes)}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={stats.isFetching}
          onClick={() => void stats.refetch()}
        >
          <RefreshCw className="size-3.5" />
          Aktualisieren
        </Button>
        {stats.dataUpdatedAt > 0 && (
          <span className="text-xs text-muted-foreground">
            Stand {new Date(stats.dataUpdatedAt).toLocaleTimeString("de-DE")}
          </span>
        )}
      </div>
      {stats.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(stats.error)}
        </p>
      )}
      {stats.isLoading && <p className="text-xs text-muted-foreground">Metriken werden geladen…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((tile) => (
              <div key={tile.label} className="rounded-xl border p-3">
                <p className="text-[11px] text-muted-foreground">{tile.label}</p>
                <p className="text-lg font-semibold tabular-nums">{tile.value}</p>
              </div>
            ))}
          </div>
          <div
            className="flex h-24 items-end gap-px rounded-xl border p-2"
            role="img"
            aria-label="Aufrufe pro Intervall"
          >
            {data.buckets.map((bucket) => (
              <div
                key={bucket.time}
                className="flex h-full flex-1 flex-col justify-end"
                title={`${new Date(bucket.time * 1000).toLocaleString("de-DE")}: ${bucket.invocations} Aufrufe, ${bucket.errors} Fehler, p50 ${formatMs(bucket.p50Ms)}, p95 ${formatMs(bucket.p95Ms)}`}
              >
                <div
                  className="rounded-t-sm bg-destructive/70"
                  style={{ height: `${(bucket.errors / peak) * 100}%` }}
                />
                <div
                  className="bg-primary/60"
                  style={{
                    height: `${(Math.max(0, bucket.invocations - bucket.errors) / peak) * 100}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Werte aus den App-Metriken von Convex. Latenzen sind nach Aufrufen gewichtete Mittel der
            Intervall-Perzentile.
          </p>
        </>
      )}
    </div>
  );
}
