import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PAYMENT_CURRENCIES,
  PAYMENT_QUERY_OPTIONS,
  type PaymentInterval,
  paymentsKey,
  paymentsList,
  toMinorUnits,
} from "@/lib/db/payments";
import { usePaymentMutation } from "./use-payment-mutation";

const INTERVALS: { value: PaymentInterval | "once"; label: string }[] = [
  { value: "once", label: "Einmalig" },
  { value: "month", label: "Monatlich" },
  { value: "year", label: "Jährlich" },
  { value: "week", label: "Wöchentlich" },
  { value: "day", label: "Täglich" },
];

export function PaymentsPriceForm({ reference }: { reference: string }) {
  const products = useQuery({
    queryKey: [...paymentsKey(reference), "products", "options"],
    queryFn: () => paymentsList(reference, "products", "project"),
    select: (page) => page.data.filter((product) => product.active),
    ...PAYMENT_QUERY_OPTIONS,
  });
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("eur");
  const [billing, setBilling] = useState<PaymentInterval | "once">("month");
  const create = usePaymentMutation(reference, ["prices"], () => setAmount(""));
  const minor = toMinorUnits(amount, currency);
  const valid = product !== "" && minor !== null;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || minor === null || create.isPending) return;
        create.mutate({
          action: "create_price",
          product,
          currency,
          amount: minor,
          interval: billing === "once" ? null : billing,
        });
      }}
    >
      <Select value={product} onValueChange={setProduct}>
        <SelectTrigger size="sm" className="h-8 w-56 text-xs" aria-label="Produkt">
          <SelectValue placeholder={products.isLoading ? "Produkte laden…" : "Produkt wählen"} />
        </SelectTrigger>
        <SelectContent>
          {(products.data ?? []).map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name ?? option.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        inputMode="decimal"
        className="h-8 w-28 text-xs"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="9,99"
        aria-label="Betrag"
        aria-invalid={amount !== "" && minor === null}
      />
      <Select value={currency} onValueChange={setCurrency}>
        <SelectTrigger size="sm" className="h-8 w-24 text-xs" aria-label="Währung">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAYMENT_CURRENCIES.map((code) => (
            <SelectItem key={code} value={code}>
              {code.toUpperCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={billing}
        onValueChange={(next) => setBilling(next as PaymentInterval | "once")}
      >
        <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label="Abrechnung">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTERVALS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" type="submit" disabled={!valid || create.isPending}>
        {create.isPending ? "Wird angelegt…" : "Preis anlegen"}
      </Button>
      {products.isError && (
        <p role="alert" className="w-full text-xs text-destructive">
          {String(products.error)}
        </p>
      )}
      {products.data?.length === 0 && (
        <p className="w-full text-[11px] text-muted-foreground">
          Zuerst ein Produkt in diesem Projekt anlegen.
        </p>
      )}
      {create.isError && (
        <p role="alert" className="w-full text-xs text-destructive">
          {String(create.error)}
        </p>
      )}
    </form>
  );
}
