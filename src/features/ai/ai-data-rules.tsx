import { CircleCheck, CircleX, Sparkles, Trash2 } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import type { AiInvariant } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function checkedLabel(rule: AiInvariant): string {
  if (rule.violations == null) return "noch nicht geprüft";
  const when = rule.checkedAt ? new Date(rule.checkedAt).toLocaleString() : "";
  const count =
    rule.violations === 0
      ? "erfüllt"
      : `${rule.violations} ${rule.violations === 1 ? "Verletzung" : "Verletzungen"}`;
  return when ? `${count} · geprüft ${when}` : count;
}

export function AiDataRules({
  open,
  rules,
  onRemove,
  onDiscover,
}: {
  open: boolean;
  rules: AiInvariant[];
  onRemove: (name: string) => void;
  onDiscover?: () => void;
}) {
  const feature = useNewFeatureVisibility<HTMLElement>(
    open ? "ai.chat.plus.knowledge.data-rules" : undefined,
  );
  return (
    <section ref={feature.ref} className="space-y-2" aria-label="Datenregeln">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          Datenregeln
          {feature.isNew && <NewBadge />}
        </h3>
        {onDiscover && (
          <Button size="sm" variant="ghost" onClick={onDiscover}>
            <Sparkles className="size-3.5" />
            Mit KI finden
          </Button>
        )}
      </div>
      {!rules.length && (
        <p className="text-xs text-muted-foreground">
          Geschäftsregeln, die in den Daten gelten müssen, z. B. „Versendete Bestellungen haben ein
          Versanddatum“. Die KI findet sie in deinen Daten, prüft sie und speichert sie nach deiner
          Bestätigung. Jede Änderung in der Sandbox wird automatisch gegen sie geprüft.
        </p>
      )}
      {rules.map((rule) => {
        const broken = (rule.violations ?? 0) > 0;
        return (
          <details key={rule.name} className="rounded-lg border px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-2 text-xs">
              {broken ? (
                <CircleX className="size-3.5 shrink-0 text-destructive" aria-label="verletzt" />
              ) : (
                <CircleCheck
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="erfüllt"
                />
              )}
              <span className="font-medium">{rule.name}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {checkedLabel(rule)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`${rule.name} entfernen`}
                onClick={(event) => {
                  event.preventDefault();
                  onRemove(rule.name);
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </summary>
            <div className="mt-2 space-y-1.5 text-xs">
              {rule.description && <p>{rule.description}</p>}
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {rule.sql}
              </pre>
            </div>
          </details>
        );
      })}
    </section>
  );
}
