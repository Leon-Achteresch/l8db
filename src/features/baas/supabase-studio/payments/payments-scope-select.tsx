import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PaymentScope } from "@/lib/db/payments";

export function PaymentsScopeSelect({
  reference,
  value,
  onChange,
}: {
  reference: string;
  value: PaymentScope;
  onChange: (scope: PaymentScope) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Bereich</span>
      <Select value={value} onValueChange={(next) => onChange(next as PaymentScope)}>
        <SelectTrigger size="sm" className="h-8 w-64 text-xs" aria-label="Bereich">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="project">Nur dieses Projekt</SelectItem>
          <SelectItem value="account">Ganzes Stripe-Konto</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-[11px] text-muted-foreground">
        {value === "project"
          ? `Stripe-Suche nach Metadatum l8db_project = ${reference}.`
          : "Zeigt alle Objekte des verbundenen Kontos, auch von anderen Apps."}{" "}
        Ändern lassen sich nur Objekte dieses Projekts.
      </span>
    </div>
  );
}
