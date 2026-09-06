import { useRef, useState } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export function DataTableHeaderName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <span
          ref={ref}
          className="min-w-0 truncate font-mono font-semibold text-[12px] tracking-tight text-foreground/80"
          onPointerEnter={() => {
            const el = ref.current;
            if (el && el.scrollWidth > el.clientWidth) setOpen(true);
          }}
          onPointerLeave={() => setOpen(false)}
        >
          {name}
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="pointer-events-none w-auto max-w-sm gap-0 p-2 font-mono text-xs font-semibold"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {name}
      </PopoverContent>
    </Popover>
  );
}
