import type { ReactNode } from "react";

export function BlockField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 text-xs font-medium">
      <span>{label}</span>
      {children}
    </div>
  );
}
