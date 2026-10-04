import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";
import { Slot } from "radix-ui";
import { type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  warning?: string | null;
  aside?: ReactNode;
  className?: string;
  bind?: boolean;
  children: ReactNode;
}

export function FormRow({
  label,
  hint,
  error,
  warning,
  aside,
  className,
  bind = true,
  children,
}: Props) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? warning ?? null;
  const control = bind ? (
    <Slot.Root
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={message || hint ? messageId : undefined}
    >
      {children}
    </Slot.Root>
  ) : (
    children
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={bind ? id : undefined} className="text-[13px] font-medium">
          {label}
        </Label>
        {aside}
      </div>
      {control}
      {message ? (
        <p
          id={messageId}
          className={cn(
            "flex items-start gap-1.5 text-xs text-pretty",
            error ? "text-destructive" : "text-amber-700 dark:text-amber-400",
          )}
        >
          {error ? (
            <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          ) : (
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          {message}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-pretty text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
