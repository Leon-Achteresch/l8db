import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePaymentMutation } from "./use-payment-mutation";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PaymentsCustomerForm({ reference }: { reference: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const create = usePaymentMutation(reference, ["customers"], () => {
    setEmail("");
    setName("");
  });
  const valid = EMAIL.test(email.trim()) && email.trim().length <= 254 && name.length <= 250;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || create.isPending) return;
        create.mutate({
          action: "create_customer",
          email: email.trim(),
          name: name.trim() || null,
        });
      }}
    >
      <Input
        type="email"
        className="h-8 w-64 text-xs"
        value={email}
        maxLength={254}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="kunde@example.com"
        aria-label="E-Mail"
      />
      <Input
        className="h-8 w-56 text-xs"
        value={name}
        maxLength={250}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name (optional)"
        aria-label="Name"
      />
      <Button size="sm" type="submit" disabled={!valid || create.isPending}>
        {create.isPending ? "Wird angelegt…" : "Kunde anlegen"}
      </Button>
      {create.isError && (
        <p role="alert" className="w-full text-xs text-destructive">
          {String(create.error)}
        </p>
      )}
    </form>
  );
}
