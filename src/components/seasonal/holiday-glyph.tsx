import type { ReactNode } from "react";
import { SpiderGlyph } from "@/components/seasonal/spider-glyph";
import { HOLIDAY_BY_ID, type HolidayId } from "@/lib/seasonal-calendar";
import { cn } from "@/lib/utils";

const ART: Record<Exclude<HolidayId, "halloween">, ReactNode> = {
  "new-year": (
    <>
      <path d="M33 59L28 69L40 64L52 69L47 59" fill="#e9bf63" />
      <path d="M27 43L17 55L19 63L31 56M53 43L63 55L61 63L49 56" fill="#d98379" />
      <path d="M40 8C26 20 25 38 27 56Q40 65 53 56C55 38 54 20 40 8Z" fill="#f9ead6" />
      <path d="M29 25Q40 29 51 25Q47 14 40 8Q33 14 29 25" fill="#e79886" />
      <path d="M24 17L20 13M59 23L64 19M60 8V14M57 11H63" fill="none" stroke="#e4bd64" />
    </>
  ),
  epiphany: (
    <>
      <path d="M40 9L49 28L70 32L55 48L58 69L40 59L22 69L25 48L10 32L31 28Z" fill="#edcc7b" />
      <path d="M40 16L44 27M18 34L28 36" stroke="#fff0c0" fill="none" />
      <path d="M24 19L22 14M60 58L65 60" stroke="#c99e54" fill="none" />
    </>
  ),
  valentine: (
    <>
      <path d="M21 42C11 29 6 36 12 45L22 52M59 42C69 29 74 36 68 45L58 52" fill="#edf1ee" />
      <path
        d="M40 65C30 59 15 46 15 32C15 17 32 14 40 26C48 14 65 17 65 32C65 46 50 59 40 65Z"
        fill="#eaa4b6"
      />
      <path d="M24 29Q28 22 33 26" fill="none" stroke="#ffe1e7" />
    </>
  ),
  carnival: (
    <>
      <path d="M24 35L17 16L33 27M56 35L63 16L47 27" fill="#e4bd62" />
      <ellipse cx="40" cy="46" rx="23" ry="22" fill="#edce78" />
      <path d="M17 38Q40 27 63 38L59 49Q49 55 40 48Q31 55 21 49Z" fill="#b3a0d9" />
      <path d="M25 25L33 8L43 25" fill="#dc9ab4" />
      <circle cx="33" cy="8" r="3" fill="#b3a0d9" />
      <path d="M12 27L9 24M67 14L70 10M65 64L70 66" stroke="#b3a0d9" fill="none" />
    </>
  ),
  "women-day": (
    <>
      <path
        d="M40 51V70M40 64Q24 67 24 58Q34 55 40 64M40 60Q56 60 55 51Q44 50 40 60"
        fill="#a6bfa0"
        stroke="#83a587"
      />
      <circle cx="25" cy="29" r="8" fill="#eaca6d" />
      <circle cx="40" cy="22" r="9" fill="#edcf7e" />
      <circle cx="54" cy="29" r="9" fill="#eaca6d" />
      <circle cx="25" cy="44" r="9" fill="#edcf7e" />
      <circle cx="55" cy="44" r="9" fill="#edcf7e" />
      <circle cx="40" cy="46" r="16" fill="#f5df9a" />
    </>
  ),
  easter: (
    <>
      <ellipse cx="29" cy="21" rx="7" ry="18" transform="rotate(-13 29 21)" fill="#f4e8d9" />
      <ellipse cx="49" cy="21" rx="7" ry="18" transform="rotate(13 49 21)" fill="#f4e8d9" />
      <path d="M28 11L31 28M50 11L47 28" stroke="#e8b4b4" strokeWidth="4" />
      <ellipse cx="39" cy="46" rx="23" ry="22" fill="#f4e8d9" />
      <path d="M53 47C46 52 44 61 47 68Q54 75 63 69C69 63 63 48 57 47Z" fill="#a9ccba" />
      <path d="M48 60L64 59M48 65L65 65" stroke="#eaf0ce" fill="none" />
      <ellipse cx="50" cy="54" rx="6" ry="4" fill="#f4e8d9" />
    </>
  ),
  "labour-day": (
    <>
      <ellipse cx="20" cy="35" rx="9" ry="13" transform="rotate(-28 20 35)" fill="#dce9ec" />
      <ellipse cx="60" cy="35" rx="9" ry="13" transform="rotate(28 60 35)" fill="#dce9ec" />
      <ellipse cx="40" cy="48" rx="21" ry="20" fill="#efcc78" />
      <path d="M23 56Q40 62 57 56M29 65Q40 69 51 65" stroke="#8e765e" fill="none" strokeWidth="5" />
      <path d="M20 35Q20 17 40 17Q60 17 60 35Z" fill="#e7aa59" />
      <path d="M17 35H63M40 17V29" stroke="#f9dda3" fill="none" strokeWidth="4" />
    </>
  ),
  "mothers-day": (
    <>
      <path
        d="M40 54V71M40 65Q25 66 24 56Q37 54 40 65M40 65Q56 65 56 55Q43 54 40 65"
        fill="#a5bf9d"
        stroke="#86a58c"
      />
      <path
        d="M40 32C22 8 9 31 25 39C5 53 30 66 37 53C50 75 69 53 56 44C76 29 52 11 45 31Z"
        fill="#e8a6bb"
      />
      <circle cx="40" cy="43" r="14" fill="#f6dba6" />
    </>
  ),
  "fathers-day": (
    <>
      <circle cx="21" cy="29" r="10" fill="#bca087" />
      <circle cx="59" cy="29" r="10" fill="#bca087" />
      <circle cx="21" cy="29" r="5" fill="#e2c0aa" />
      <circle cx="59" cy="29" r="5" fill="#e2c0aa" />
      <rect x="18" y="25" width="44" height="42" rx="20" fill="#c7ac91" />
      <path d="M20 31Q23 15 45 20L57 29L66 33Z" fill="#9db9a8" />
      <path d="M29 59L40 64L29 69ZM51 59L40 64L51 69Z" fill="#a0b9cd" />
    </>
  ),
  pentecost: (
    <>
      <path d="M24 46Q1 17 18 22L35 34M56 46Q79 17 62 22L45 34" fill="#e8eef0" />
      <path d="M21 58L16 69L32 64" fill="#e8eef0" />
      <ellipse cx="40" cy="45" rx="23" ry="20" fill="#f3eee2" />
      <path d="M59 43L69 47L59 50" fill="#e4be77" />
      <path d="M60 57L73 54M67 56L68 51M70 55L74 59" fill="none" stroke="#9ab598" />
    </>
  ),
  "corpus-christi": (
    <>
      <path d="M40 56V71M40 65L27 59M40 68L55 61" stroke="#8ea989" fill="none" />
      <path
        d="M32 27L29 13L40 24L49 13L48 28L63 25L55 37L67 45L53 48L55 62L42 55L31 65L28 51L14 50L24 39L17 28Z"
        fill="#edcb78"
      />
      <circle cx="40" cy="43" r="17" fill="#f4dea3" />
    </>
  ),
  assumption: (
    <>
      <path d="M10 64Q25 37 66 56Q52 81 10 64Z" fill="#aac3a0" />
      <path d="M13 65L61 58" stroke="#86a383" fill="none" />
      <ellipse cx="40" cy="44" rx="23" ry="21" fill="#e49e8f" />
      <path d="M40 26V34M40 56V64" fill="none" stroke="#a1756f" />
      <circle cx="24" cy="39" r="4" fill="#a1756f" />
      <circle cx="56" cy="39" r="4" fill="#a1756f" />
      <circle cx="27" cy="55" r="3" fill="#a1756f" />
      <circle cx="53" cy="55" r="3" fill="#a1756f" />
      <path d="M33 24L29 16M47 24L51 16" stroke="#a1756f" fill="none" />
    </>
  ),
  unity: (
    <>
      <path
        d="M13 36Q13 26 23 26H36V35Q48 29 48 41Q48 53 36 47V62H23Q13 62 13 52Z"
        fill="#a9c4de"
      />
      <path
        d="M67 36Q67 26 57 26H44V35Q56 29 56 41Q56 53 44 47V62H57Q67 62 67 52Z"
        fill="#edc57b"
      />
      <path d="M29 16L26 12M51 16L54 12M40 14V9" stroke="#c7b9cf" fill="none" />
    </>
  ),
  remembrance: (
    <>
      <ellipse cx="40" cy="68" rx="24" ry="4" fill="#e4d3b6" />
      <rect x="25" y="33" width="30" height="35" rx="7" fill="#f1dfb7" />
      <path d="M25 39Q31 33 35 39V47Q39 52 41 45V38Q47 31 55 39" fill="#f9ecd2" />
      <path d="M40 7C23 25 35 32 40 30C51 29 51 20 40 7Z" fill="#e8b967" />
      <path d="M40 19Q35 28 40 29Q46 27 40 19" fill="#fff0bc" />
    </>
  ),
  martin: (
    <>
      <path d="M28 23C28 3 52 3 52 23" fill="none" stroke="#bda285" />
      <rect x="19" y="26" width="42" height="38" rx="13" fill="#efd18a" />
      <path d="M30 28Q23 45 30 62M50 28Q57 45 50 62" stroke="#dfb56d" fill="none" />
      <path d="M21 25H59M24 65H56M40 66V72" stroke="#b6977a" fill="none" strokeWidth="4" />
      <path d="M12 38L8 36M68 38L72 36" stroke="#e7c274" fill="none" />
    </>
  ),
  advent: (
    <>
      <path d="M40 10L49 28L68 31L55 46L57 66L40 57L23 66L25 46L12 31L31 28Z" fill="#bf9a77" />
      <path d="M40 19L47 33L59 35L49 45L50 55L40 49L30 55L31 45L21 35L33 33Z" fill="#f2e3cc" />
      <circle cx="40" cy="61" r="2" fill="#f2e3cc" />
    </>
  ),
  nicholas: (
    <>
      <path d="M25 28H52V49L62 53Q70 57 63 65Q59 70 47 69H26Q20 69 20 62L25 49Z" fill="#de9a91" />
      <rect x="20" y="21" width="36" height="13" rx="5" fill="#f2e7d5" />
      <path d="M26 20L22 7M19 9L26 8" stroke="#dbc29b" fill="none" strokeWidth="5" />
      <path d="M39 21L36 11L43 5L49 12L46 21" fill="#a7bea0" />
      <path d="M24 63Q40 67 61 62" stroke="#bf7f78" fill="none" />
    </>
  ),
  christmas: (
    <>
      <rect x="35" y="59" width="10" height="13" rx="3" fill="#bd9b7b" />
      <path d="M40 15L20 38H28L12 57Q40 71 68 57L52 38H60Z" fill="#9dc4ab" />
      <path d="M26 34Q40 40 54 34M22 50Q40 57 58 50" stroke="#decd93" fill="none" />
      <path d="M40 4L43 11L51 12L45 17L46 24L40 20L34 24L35 17L29 12L37 11Z" fill="#edcd78" />
      <circle cx="25" cy="55" r="3" fill="#dd9a96" />
      <circle cx="52" cy="37" r="3" fill="#dd9a96" />
      <circle cx="52" cy="58" r="3" fill="#f1e6be" />
    </>
  ),
};

export function HolidayGlyph({ holiday, className }: { holiday: HolidayId; className?: string }) {
  if (holiday === "halloween") return <SpiderGlyph gaze="ahead" className={className} />;
  return (
    <svg
      viewBox="0 0 80 80"
      aria-hidden
      className={cn("size-16 overflow-visible", className)}
      data-holiday-glyph={holiday}
    >
      <ellipse cx="40" cy="74" rx="22" ry="3" fill={HOLIDAY_BY_ID[holiday].color} opacity="0.15" />
      <g strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ART[holiday]}
      </g>
      <g fill="#514a49">
        <circle cx="35" cy="43" r="2.1" />
        <circle cx="45" cy="43" r="2.1" />
      </g>
      <g fill="#fff8ef">
        <circle cx="35.6" cy="42.4" r="0.7" />
        <circle cx="45.6" cy="42.4" r="0.7" />
      </g>
      <g fill="#dc9295" opacity="0.65">
        <ellipse cx="30" cy="48" rx="3" ry="1.8" />
        <ellipse cx="50" cy="48" rx="3" ry="1.8" />
      </g>
      <path
        d="M37 48Q40 51.5 43 48"
        fill="none"
        stroke="#76615a"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
