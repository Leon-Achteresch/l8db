import { type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Props {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: Props) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={description ? `${id}-description` : undefined}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="text-[13px] leading-snug font-normal">
          {label}
        </Label>
        {description && (
          <p id={`${id}-description`} className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
