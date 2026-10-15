import { useHalloween } from "@/lib/seasonal";
import { cn } from "@/lib/utils";

const WEB =
  "M64 0L64 64M64 0L39.5 59.1M64 0L18.7 45.3M64 0L4.9 24.5M64 0L0 0M64 11Q62.3 8.6 59.8 10.2Q59.1 7.3 56.2 7.8Q56.7 4.9 53.8 4.2Q55.4 1.7 53 0M64 23Q60.4 18 55.2 21.2Q53.8 15.3 47.7 16.3Q48.7 10.2 42.8 8.8Q46 3.6 41 0M64 36Q58.4 28.2 50.2 33.3Q48 23.9 38.5 25.5Q40.1 16 30.7 13.8Q35.8 5.6 28 0M64 50Q56.2 39.2 44.9 46.2Q41.8 33.3 28.6 35.4Q30.7 22.2 17.8 19.1Q24.8 7.8 14 0";

export function Cobweb({ className }: { className?: string }) {
  const halloween = useHalloween();
  if (!halloween) return null;
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      data-seasonal="cobweb"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.7}
      strokeLinecap="round"
      className={cn("pointer-events-none absolute right-0 top-0", className)}
    >
      <path d={WEB} />
    </svg>
  );
}
