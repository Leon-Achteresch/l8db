import type { ReactNode } from "react";

export function WidgetPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center rounded-2xl border border-dashed p-5 text-center text-xs leading-relaxed text-muted-foreground">
      <div>{children}</div>
    </div>
  );
}
