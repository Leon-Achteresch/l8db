import { WitchHat } from "@/components/seasonal/witch-hat";
import { useHalloween } from "@/lib/seasonal";
import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
  alt?: string;
}

export function AppLogo({ className, alt = "l8db Logo" }: AppLogoProps) {
  const halloween = useHalloween();
  const logo = (
    <img
      src="/logo.png"
      alt={alt}
      draggable={false}
      className={cn("aspect-square shrink-0 rounded-[22%] object-contain", className)}
    />
  );
  if (!halloween) return logo;
  return (
    <span className="relative inline-flex shrink-0">
      {logo}
      <WitchHat className="-left-[20%] -top-[36%] w-[66%] -rotate-[20deg]" />
    </span>
  );
}
