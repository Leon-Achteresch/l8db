import { Cobweb } from "@/components/seasonal/cobweb";
import { HolidayGlyph } from "@/components/seasonal/holiday-glyph";
import { useHoliday } from "@/lib/seasonal";
import { cn } from "@/lib/utils";

export function SeasonalCorner({ className }: { className?: string }) {
  const holiday = useHoliday();
  if (!holiday) return null;
  if (holiday === "halloween") return <Cobweb className={className} />;
  return (
    <div
      aria-hidden
      data-seasonal="corner"
      className={cn("pointer-events-none absolute right-3 top-3 opacity-35", className)}
    >
      <HolidayGlyph holiday={holiday} className="size-full" />
    </div>
  );
}
