import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type DbRlsTable, supabaseStudioDatabaseList } from "@/lib/db/supabase-studio-database";
import { databaseListKey } from "../database/use-database-list";
import { PolicyCoverageSummary } from "../policies/policy-coverage-summary";

export function SupabaseOverviewProtection({
  reference,
  onOpen,
}: {
  reference: string;
  onOpen: () => void;
}) {
  const tables = useQuery({
    queryKey: databaseListKey(reference, "rls_tables", "public", "", "", 0),
    queryFn: () =>
      supabaseStudioDatabaseList<DbRlsTable>(reference, "rls_tables", { schema: "public" }),
  });
  const items = tables.data?.items ?? [];
  const open = items.filter((table) => !table.rls_enabled);
  const safe = tables.isSuccess && items.length > 0 && open.length === 0;
  const limit = tables.data?.has_more ? " (erste 100 Tabellen nach Name)" : "";

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {safe ? (
            <ShieldCheck className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldAlert
              className={`mt-0.5 size-4 ${open.length ? "text-destructive" : "text-muted-foreground"}`}
            />
          )}
          <div>
            <h3 className="text-sm font-semibold">Schutz der Tabellen in public</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tables.isPending
                ? "Wird geprüft…"
                : tables.isError
                  ? "Schutz konnte nicht geprüft werden."
                  : items.length === 0
                    ? "Das Schema public enthält keine Tabellen."
                    : open.length
                      ? `Ohne Row Level Security: ${open.map((table) => table.name).join(", ")}${limit}`
                      : `Alle Tabellen nutzen Row Level Security${limit}.`}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          Richtlinien
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
      {tables.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(tables.error)}
        </p>
      ) : (
        items.length > 0 && <PolicyCoverageSummary tables={items} />
      )}
    </section>
  );
}
