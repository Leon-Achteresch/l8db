import { cn } from "@/lib/utils";
import { serviceLabel, statusLabel } from "./supabase-services";
import { useSupabaseHealth } from "./use-supabase-health";

export function SupabaseProjectPulse({ reference }: { reference: string }) {
  const health = useSupabaseHealth(reference);
  const down = health.data?.filter((service) => !service.healthy).length ?? 0;

  return (
    <section aria-label="Dienststatus" className="px-1">
      <p className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
        Dienste
        <span className="font-normal normal-case tracking-normal">
          {health.isPending
            ? "wird geprüft…"
            : health.isError
              ? "nicht erreichbar"
              : down
                ? `${down} gestört`
                : "alle aktiv"}
        </span>
      </p>
      {health.data && (
        <ul className="grid grid-cols-3 gap-x-2 gap-y-1">
          {health.data.map((service) => (
            <li
              key={service.name}
              title={`${serviceLabel(service.name)}: ${statusLabel(service.status)}`}
              className="flex min-w-0 items-center gap-1.5 text-[11px]"
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  service.healthy ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
              <span className="truncate">{serviceLabel(service.name)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
