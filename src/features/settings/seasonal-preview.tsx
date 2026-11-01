import { Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppLogo } from "@/components/app-logo";
import { HolidayAccessory } from "@/components/seasonal/holiday-accessory";
import { HolidayGlyph } from "@/components/seasonal/holiday-glyph";
import { Button } from "@/components/ui/button";
import { endSpiderVisit, useSeasonalStore, visitHoliday } from "@/lib/seasonal";
import { HOLIDAY_BY_ID, HOLIDAYS, type HolidayId, holidayForDate } from "@/lib/seasonal-calendar";
import { cn } from "@/lib/utils";

export function SeasonalPreview() {
  const [selected, setSelected] = useState<HolidayId>(
    () => holidayForDate(new Date()) ?? "christmas",
  );
  const preview = useSeasonalStore((state) => state.preview);
  const info = HOLIDAY_BY_ID[selected];
  useEffect(() => () => endSpiderVisit(), []);
  return (
    <div className="space-y-4" data-seasonal-preview={selected}>
      <div
        className="relative isolate flex min-h-48 flex-wrap items-center gap-5 overflow-hidden rounded-2xl border bg-card p-5 sm:p-6"
        style={{
          backgroundImage: `radial-gradient(ellipse at 5% 90%, ${info.color}20, transparent 65%)`,
        }}
      >
        <div
          className="relative flex size-24 shrink-0 items-center justify-center rounded-full sm:size-28"
          style={{ backgroundColor: `${info.color}15` }}
        >
          <HolidayGlyph holiday={selected} className="size-20 sm:size-24" />
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {info.name} · {info.period}
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">
            Hallo, ich bin {info.guest}.
          </h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            „{info.quip}“
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={(event) => {
                const rect = event.currentTarget
                  .closest("[data-seasonal-preview]")
                  ?.getBoundingClientRect();
                if (!rect) return;
                visitHoliday(
                  selected,
                  { x: Math.max(180, rect.right - 30), top: rect.top, y: rect.top + 48 },
                  info.quip,
                  true,
                );
              }}
            >
              <Play className="size-3" />
              Besuch starten
            </Button>
            {preview ? (
              <Button size="sm" variant="ghost" onClick={endSpiderVisit}>
                <X className="size-3" />
                Verabschieden
              </Button>
            ) : null}
            <span className="relative ml-3 inline-flex size-6" aria-hidden>
              <img src="/logo.png" alt="" className="size-6 rounded-md" />
              <HolidayAccessory
                holiday={selected}
                className="-left-1.5 -top-2.5 w-5 -rotate-[15deg]"
              />
            </span>
          </div>
        </div>
      </div>
      <fieldset
        aria-label="Feiertag für die Vorschau auswählen"
        className="grid grid-cols-2 gap-2 @min-[36rem]:grid-cols-3 @min-[52rem]:grid-cols-4"
      >
        {HOLIDAYS.map((holiday) => (
          <button
            key={holiday.id}
            type="button"
            aria-pressed={selected === holiday.id}
            data-holiday-option={holiday.id}
            onClick={() => {
              endSpiderVisit();
              setSelected(holiday.id);
            }}
            className={cn(
              "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === holiday.id
                ? "border-foreground/25 bg-muted/70"
                : "border-border/60 bg-card/30",
            )}
          >
            <HolidayGlyph holiday={holiday.id} className="size-9 shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-medium leading-snug">{holiday.name}</span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                {holiday.guest}
              </span>
            </span>
          </button>
        ))}
      </fieldset>
      <p className="flex items-center gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <AppLogo className="size-4" />
        Automatisch zur passenden Zeit. Höchstens ein Besuch am Tag, nie in Produktionsverbindungen.
        Ein Klick auf den Gast schickt ihn weiter.
      </p>
    </div>
  );
}
