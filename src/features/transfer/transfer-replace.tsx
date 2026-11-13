import { NewBadge } from "@/components/new-badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TransferContent, TransferPlan } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function TransferReplace({
  plan,
  replace,
  whole,
  content,
  onReplace,
}: {
  plan: TransferPlan | null;
  replace: boolean;
  whole: boolean;
  content: TransferContent;
  onReplace: (value: boolean) => void;
}) {
  const label =
    content === "data"
      ? "Zieltabellen vorher leeren"
      : whole
        ? "Ziel vollständig überschreiben"
        : "Vorhandene Objekte überschreiben";
  const feature = useNewFeatureVisibility<HTMLElement>("transfer.replace");
  const replaced = plan?.replace ? plan.replaced : [];
  return (
    <section
      ref={feature.ref}
      className={
        replace
          ? "rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-xs"
          : "rounded-xl border bg-card p-4 text-xs"
      }
    >
      <div className="flex items-center gap-2">
        <Switch id="transfer-replace" size="sm" checked={replace} onCheckedChange={onReplace} />
        <Label htmlFor="transfer-replace" className="text-xs font-semibold">
          {label}
        </Label>
        {feature.isNew && <NewBadge />}
      </div>
      {plan && !plan.atomic && replace && (
        <p className="mt-2 text-muted-foreground">Lässt sich nicht zurückrollen.</p>
      )}
      {replace && plan?.replace && (
        <div className="mt-2">
          <p className="font-medium text-destructive">
            {replaced.length
              ? `${replaced.length} Objekte im Ziel werden gelöscht`
              : "Das Zielschema ist leer"}
          </p>
          {replaced.length > 0 && (
            <ul className="mt-1.5 max-h-40 overflow-y-auto font-mono break-all text-muted-foreground">
              {replaced.slice(0, 200).map((object) => (
                <li key={object}>{object}</li>
              ))}
              {replaced.length > 200 && <li>… und {replaced.length - 200} weitere</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
