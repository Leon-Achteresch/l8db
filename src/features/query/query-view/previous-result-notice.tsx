import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function PreviousResultNotice({ sql, at }: { sql: string; at: number | null }) {
  const feature = useNewFeatureVisibility<HTMLDetailsElement>("query.results.keep-on-error");
  return (
    <details
      ref={feature.ref}
      className="shrink-0 border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
    >
      <summary className="cursor-pointer">
        Vorheriger erfolgreicher Lauf{at !== null && ` vom ${new Date(at).toLocaleString("de-DE")}`}{" "}
        — die fehlgeschlagene Abfrage hat diese Daten nicht aktualisiert.{" "}
        {feature.isNew && <NewBadge />}
      </summary>
      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-mono">
        {sql || "SQL dieses Laufs nicht verfügbar"}
      </pre>
    </details>
  );
}
