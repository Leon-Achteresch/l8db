import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui-plugins/api";
import { toneSoft } from "@/lib/ui-plugins/tones";

export function Pill({ tone, children }: { tone?: Tone; children?: ReactNode }) {
  return (
    <span
      className="inline-flex h-4 max-w-full shrink-0 items-center truncate rounded-full px-1.5 font-sans text-[10.5px] font-medium leading-4"
      style={toneSoft(tone)}
    >
      {children}
    </span>
  );
}
