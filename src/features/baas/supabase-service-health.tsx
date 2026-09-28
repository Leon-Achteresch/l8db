import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabaseHealth } from "@/lib/db";

const SERVICE_LABELS: Record<string, string> = {
  auth: "Auth",
  db: "PostgreSQL",
  pooler: "Pooler",
  realtime: "Realtime",
  rest: "Data API",
  storage: "Storage",
};

export function SupabaseServiceHealth({ reference }: { reference: string }) {
  const health = useQuery({
    queryKey: ["supabase", reference, "health"],
    queryFn: () => supabaseHealth(reference),
  });

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Dienste</h3>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dienste aktualisieren"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          <RefreshCw className={`size-3.5 ${health.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {health.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Status wird geladen…</p>
      ) : health.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(health.error)}
        </p>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {health.data.map((service) => (
            <div key={service.name} className="rounded-lg border bg-background/50 px-3 py-2">
              <p className="text-xs font-medium">{SERVICE_LABELS[service.name] ?? service.name}</p>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={`size-1.5 rounded-full ${service.healthy ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {service.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
