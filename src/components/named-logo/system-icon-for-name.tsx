import { cn } from "@/lib/utils";
import { candidateKeys } from "./brand-icons";
import { NAME_TO_SYSTEM } from "./system-icons";

export function SystemIconForName({ name, className }: { name: string; className?: string }) {
  for (const key of candidateKeys(name)) {
    const Icon = NAME_TO_SYSTEM[key];
    if (Icon)
      return (
        <Icon className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />
      );
  }
  return null;
}
