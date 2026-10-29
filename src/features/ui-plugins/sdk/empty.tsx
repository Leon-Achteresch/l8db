import type { ReactNode } from "react";

export function Empty({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-16 items-center justify-center p-4 text-center font-sans text-sm text-muted-foreground">
      {children ?? "Keine Einträge"}
    </div>
  );
}
