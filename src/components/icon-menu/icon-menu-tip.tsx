import type { Ref } from "react";
import { Kbd } from "@/components/ui/kbd";

export function IconMenuTip({ ref }: { ref: Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="tooltip-content"
      data-icon-menu-tip=""
      className="pointer-events-none absolute top-0 left-0 z-10 inline-flex w-max max-w-64 items-center gap-1.5 rounded-xl bg-foreground px-3 py-1.5 text-xs text-background opacity-0 has-[kbd:not([hidden])]:pr-1.5 after:absolute after:top-full after:left-1/2 after:size-2.5 after:-translate-x-1/2 after:-translate-y-[calc(50%+2px)] after:rotate-45 after:rounded-[2px] after:bg-foreground"
    >
      <span />
      <Kbd hidden />
    </span>
  );
}
