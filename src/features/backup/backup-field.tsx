import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface BackupFieldProps {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}

export function BackupField({ label, htmlFor, children }: BackupFieldProps) {
  return (
    <div className="grid min-h-8 grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-4">
      <Label
        htmlFor={htmlFor}
        className="justify-self-end text-right text-xs font-normal text-muted-foreground"
      >
        {label}
      </Label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
