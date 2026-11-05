import { type ReactNode, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function CloudConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  acknowledgement,
  destructive,
  busy,
  disabled,
  size = "sm",
  variant = "outline",
  icon,
  onConfirm,
}: {
  label: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  acknowledgement?: string;
  destructive?: boolean;
  busy?: boolean;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default" | "destructive";
  icon?: ReactNode;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const checkboxId = useId();
  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={busy || disabled}
        onClick={() => {
          setAcknowledged(false);
          setOpen(true);
        }}
      >
        {icon}
        {label}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">{description}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {acknowledgement && (
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id={checkboxId}
                checked={acknowledged}
                onCheckedChange={(value) => setAcknowledged(value === true)}
              />
              <label htmlFor={checkboxId} className="leading-tight">
                {acknowledgement}
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant={destructive ? "destructive" : "default"}
              disabled={Boolean(acknowledgement) && !acknowledged}
              onClick={onConfirm}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
