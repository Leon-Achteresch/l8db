import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const TIP = "M0 0 L10 9.2 Q12 11 14 9.2 L24 0";

export function DropdownMenuArrow({
  container,
  className,
}: {
  container: HTMLElement | null;
  className?: string;
}) {
  if (!container) return null;
  return createPortal(
    <DropdownMenuPrimitive.Arrow asChild width={24} height={11}>
      <svg
        data-menu-arrow=""
        viewBox="0 0 24 11"
        aria-hidden
        className={cn(
          "pointer-events-none fill-(--menu) stroke-black/15 dark:stroke-black/70",
          className,
        )}
      >
        <path d={`${TIP} Z`} stroke="none" />
        <path d={TIP} fill="none" strokeWidth={1} />
      </svg>
    </DropdownMenuPrimitive.Arrow>,
    container,
  );
}
