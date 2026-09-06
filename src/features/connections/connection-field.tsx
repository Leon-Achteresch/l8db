import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props extends ComponentProps<typeof Input> {
  label: string;
}

export function ConnectionField({ label, id, ...props }: Props) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} className="h-10 rounded-lg bg-background/70" {...props} />
    </div>
  );
}
