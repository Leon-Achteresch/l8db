import { type ComponentProps, useId } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function VaultField({ label, ...props }: { label: string } & ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </FieldLabel>
      <Input id={id} {...props} />
    </Field>
  );
}
