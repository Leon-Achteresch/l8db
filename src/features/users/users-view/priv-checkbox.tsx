import { LoaderIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function PrivCheckbox({
  checked,
  pending,
  onToggle,
}: {
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  if (pending) {
    return (
      <div className="inline-flex items-center justify-center size-4">
        <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Checkbox
      checked={checked}
      onCheckedChange={onToggle}
      className={cn(
        "size-4",
        checked && "data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600",
      )}
    />
  );
}
