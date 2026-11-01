import type { ReactNode } from "react";
import { WitchHat } from "@/components/seasonal/witch-hat";
import { HOLIDAY_BY_ID, type HolidayId } from "@/lib/seasonal-calendar";
import { cn } from "@/lib/utils";

const HATS: Partial<Record<HolidayId, ReactNode>> = {
  "new-year": (
    <>
      <path d="M5 24L13 3L27 24Z" fill="#edbf70" />
      <path d="M9 14L20 14M7 20H24" stroke="#e5979d" strokeWidth="3" />
      <circle cx="13" cy="3" r="2.5" fill="#e5979d" />
    </>
  ),
  epiphany: <path d="M4 10L10 16L16 6L22 16L28 10L25 25H7Z" />,
  valentine: <path d="M16 25C9 20 2 14 5 8C8 3 14 5 16 9C18 5 24 3 27 8C30 14 23 20 16 25Z" />,
  carnival: (
    <>
      <path d="M3 11Q16 5 29 11L27 23Q19 27 16 20Q12 27 5 23Z" />
      <path d="M7 15L12 16M21 16L26 15" stroke="#fff0d7" strokeWidth="3" />
    </>
  ),
  easter: (
    <>
      <ellipse cx="10" cy="13" rx="5" ry="13" transform="rotate(-16 10 13)" fill="#f2e2cf" />
      <ellipse cx="23" cy="13" rx="5" ry="13" transform="rotate(16 23 13)" fill="#f2e2cf" />
      <path d="M9 6L12 19M24 6L21 19" stroke="#e7aeae" strokeWidth="2.5" />
    </>
  ),
  "labour-day": (
    <>
      <path d="M4 22Q4 6 16 6Q28 6 28 22Z" />
      <path d="M2 23H30M16 7V18" stroke="#ffe4a7" strokeWidth="3" />
    </>
  ),
  "fathers-day": (
    <>
      <path d="M4 21Q4 6 17 7Q27 8 26 21L32 25H3Z" />
      <path d="M21 22L32 25" stroke="#7b9d89" strokeWidth="2" />
    </>
  ),
  remembrance: (
    <>
      <rect x="10" y="15" width="12" height="13" rx="3" fill="#ebd7ad" />
      <path d="M16 1Q4 13 16 13Q28 13 16 1Z" />
    </>
  ),
  martin: (
    <>
      <path d="M11 8C11 0 21 0 21 8" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="6" y="9" width="20" height="17" rx="5" />
      <path d="M4 8H28M7 27H25" stroke="#af9176" strokeWidth="2" />
    </>
  ),
  nicholas: (
    <>
      <path d="M5 23Q9 3 21 5L30 14L25 16L20 11L23 24Z" fill="#d88d84" />
      <rect x="3" y="21" width="23" height="7" rx="3" fill="#f5e8d7" />
      <circle cx="29" cy="15" r="4" fill="#f5e8d7" />
    </>
  ),
  christmas: (
    <>
      <path d="M5 23Q9 3 21 5L30 14L25 16L20 11L23 24Z" fill="#d88d84" />
      <rect x="3" y="21" width="23" height="7" rx="3" fill="#f5e8d7" />
      <circle cx="29" cy="15" r="4" fill="#f5e8d7" />
    </>
  ),
  advent: <path d="M16 2L20 11L30 12L23 19L24 29L16 24L8 29L9 19L2 12L12 11Z" />,
  pentecost: (
    <path
      d="M3 19Q5 2 15 14Q23 6 29 12L23 18Q20 28 9 24L3 27Z"
      fill="#e1e8e9"
      stroke="#a9c7d9"
      strokeWidth="1"
    />
  ),
  unity: (
    <>
      <path d="M4 8H15V15Q22 12 22 18Q22 24 15 21V28H4Z" />
      <path d="M17 8H28V28H17V21Q24 24 24 18Q24 12 17 15Z" fill="#edc57b" />
    </>
  ),
};

export function HolidayAccessory({
  holiday,
  className,
}: {
  holiday: HolidayId;
  className?: string;
}) {
  if (holiday === "halloween") return <WitchHat className={className} />;
  return (
    <svg
      viewBox="0 0 32 30"
      aria-hidden
      data-seasonal="accessory"
      data-holiday={holiday}
      className={cn("pointer-events-none absolute z-20 overflow-visible", className)}
      fill={HOLIDAY_BY_ID[holiday].color}
    >
      {HATS[holiday] ?? (
        <>
          <path d="M16 19V29M16 25L6 21M16 25L26 21" fill="none" stroke="#96b195" strokeWidth="2" />
          <path d="M16 7C5 -3 0 11 8 14C-2 24 13 27 16 20C20 29 33 22 25 14C34 5 21 -2 16 7Z" />
          <circle cx="16" cy="13" r="5" fill="#f5dea3" />
        </>
      )}
    </svg>
  );
}
