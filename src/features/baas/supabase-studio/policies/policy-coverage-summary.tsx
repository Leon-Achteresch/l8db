import type { DbRlsTable } from "@/lib/db/supabase-studio-database";

export function PolicyCoverageSummary({ tables }: { tables: DbRlsTable[] }) {
  const open = tables.filter((table) => !table.rls_enabled).length;
  const locked = tables.filter(
    (table) => table.rls_enabled && (table.commands ?? []).length === 0,
  ).length;
  const guarded = tables.length - open - locked;
  const parts = [
    {
      label: "Geregelt",
      value: guarded,
      hint: "RLS aktiv, Zugriff über Richtlinien",
      color: "bg-emerald-500",
    },
    {
      label: "Gesperrt",
      value: locked,
      hint: "RLS aktiv, aber keine erlaubende Richtlinie: Data API sieht nichts",
      color: "bg-muted-foreground/40",
    },
    {
      label: "Offen",
      value: open,
      hint: "RLS aus: jeder mit anon Key hat Tabellenrechte",
      color: "bg-destructive",
    },
  ];
  return (
    <section aria-label="Schutz der Tabellen" className="space-y-2.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {parts.map((part) =>
          part.value ? (
            <span
              key={part.label}
              className={part.color}
              style={{ flexGrow: part.value }}
              title={`${part.label}: ${part.value}`}
            />
          ) : null,
        )}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {parts.map((part) => (
          <div key={part.label} title={part.hint} className="flex items-baseline gap-2">
            <span className={`size-2 translate-y-[-1px] rounded-[3px] ${part.color}`} />
            <dt className="text-xs text-muted-foreground">{part.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{part.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
