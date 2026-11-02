import { HolidayAccessory } from "@/components/seasonal/holiday-accessory";
import { useHoliday } from "@/lib/seasonal";
import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
  alt?: string;
}

export function AppLogo({ className, alt = "l8db Logo" }: AppLogoProps) {
  const holiday = useHoliday();
  const logo = (
    <img
      src="/logo.png"
      alt={alt}
      draggable={false}
      className={cn("aspect-square shrink-0 rounded-[22%] object-contain", className)}
    />
  );
  if (!holiday) return logo;
  return (
    <span className="relative inline-flex shrink-0">
      {logo}
      <HolidayAccessory
        holiday={holiday}
        className="-left-[20%] -top-[36%] w-[66%] -rotate-[20deg]"
      />
    </span>
  );
}
