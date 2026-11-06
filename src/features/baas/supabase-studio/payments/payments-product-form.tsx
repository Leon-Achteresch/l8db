import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePaymentMutation } from "./use-payment-mutation";

export function PaymentsProductForm({ reference }: { reference: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = usePaymentMutation(reference, ["products"], () => {
    setName("");
    setDescription("");
  });
  const valid = name.trim().length > 0 && name.trim().length <= 250 && description.length <= 2000;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || create.isPending) return;
        create.mutate({
          action: "create_product",
          name: name.trim(),
          description: description.trim() || null,
        });
      }}
    >
      <Input
        className="h-8 w-56 text-xs"
        value={name}
        maxLength={250}
        onChange={(event) => setName(event.target.value)}
        placeholder="Produktname"
        aria-label="Produktname"
      />
      <Input
        className="h-8 min-w-48 flex-1 text-xs"
        value={description}
        maxLength={2000}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Beschreibung (optional)"
        aria-label="Beschreibung"
      />
      <Button size="sm" type="submit" disabled={!valid || create.isPending}>
        {create.isPending ? "Wird angelegt…" : "Produkt anlegen"}
      </Button>
      {create.isError && (
        <p role="alert" className="w-full text-xs text-destructive">
          {String(create.error)} Erneut absenden wiederholt dieselbe Anfrage ohne Duplikat.
        </p>
      )}
    </form>
  );
}
