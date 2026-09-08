import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
  alt?: string;
}

export function AppLogo({ className, alt = "l8db Logo" }: AppLogoProps) {
  return (
    <img
      src="/logo.png"
      alt={alt}
      draggable={false}
      className={cn("aspect-square shrink-0 rounded-full object-contain", className)}
    />
  );
}
