import { lazy, Suspense, useEffect } from "react";
import { endSpiderVisit, useSeasonalStore } from "@/lib/seasonal";
import { useSettingsStore } from "@/lib/settings";

const DataSpider = lazy(() =>
  import("@/components/seasonal/data-spider").then(({ DataSpider }) => ({ default: DataSpider })),
);

const HolidayVisitor = lazy(() =>
  import("@/components/seasonal/holiday-visitor").then(({ HolidayVisitor }) => ({
    default: HolidayVisitor,
  })),
);

export function SpiderLayer() {
  const visit = useSeasonalStore((state) => state.visit);
  const enabled = useSettingsStore((state) => state.seasonalAccents);
  useEffect(() => {
    if (!enabled) endSpiderVisit();
  }, [enabled]);
  if (!visit || !enabled) return null;
  return (
    <Suspense fallback={null}>
      {visit.holiday && visit.holiday !== "halloween" ? (
        <HolidayVisitor
          key={visit.id}
          visit={visit}
          holiday={visit.holiday}
          onDone={endSpiderVisit}
        />
      ) : (
        <DataSpider key={visit.id} visit={visit} onDone={endSpiderVisit} />
      )}
    </Suspense>
  );
}
