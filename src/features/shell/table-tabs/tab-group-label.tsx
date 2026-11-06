import type { TabGroup } from "@/lib/ui-plugins/api";
import { TONE_COLORS } from "@/lib/ui-plugins/tones";

export function TabGroupLabel({ group }: { group: TabGroup }) {
  const color = TONE_COLORS[group.tone ?? "neutral"];
  return (
    <span
      data-tab-group={group.id}
      className="ml-1 flex h-5 max-w-32 shrink-0 select-none items-center truncate rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color, backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)` }}
    >
      {group.label}
    </span>
  );
}
