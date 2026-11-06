import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AiComposerFrame({
  approvals,
  minimized = false,
  children,
}: {
  approvals?: ReactNode;
  minimized?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {approvals && (
        <div className="mb-2 max-h-[55vh] space-y-2 overflow-auto p-1">{approvals}</div>
      )}
      <div
        className={cn(
          "overflow-hidden rounded-[22px] bg-card shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_6%,transparent),0_10px_30px_-14px_oklch(0_0_0/20%)] transition-shadow focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent),0_10px_30px_-14px_oklch(0_0_0/24%)]",
          minimized &&
            "group-not-data-active/mini:overflow-visible group-not-data-active/mini:bg-transparent group-not-data-active/mini:shadow-none",
        )}
      >
        {children}
      </div>
    </>
  );
}
