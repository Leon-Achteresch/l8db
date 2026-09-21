import { cn } from "@/lib/utils";

const PALETTES = {
  light: { bg: "bg-zinc-100", panel: "bg-white", line: "bg-zinc-200", accent: "bg-indigo-500" },
  dark: { bg: "bg-zinc-950", panel: "bg-zinc-900", line: "bg-zinc-700", accent: "bg-indigo-400" },
};

function windowMock(palette: (typeof PALETTES)["light"], className?: string) {
  return (
    <div className={cn("absolute inset-0 flex gap-1.5 p-2", palette.bg, className)}>
      <div className={cn("flex w-1/4 flex-col gap-1 rounded-md p-1.5", palette.panel)}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn("h-1.5 rounded-full", i === 1 ? palette.accent : palette.line)}
          />
        ))}
      </div>
      <div className={cn("flex flex-1 flex-col gap-1 rounded-md p-1.5", palette.panel)}>
        <span className={cn("mb-0.5 h-2 w-1/2 rounded-full", palette.accent)} />
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("h-1.5 rounded-full", palette.line)}
            style={{ width: `${92 - i * 11}%` }}
          />
        ))}
      </div>
    </div>
  );
}

interface OnboardingThemePreviewProps {
  variant: "light" | "dark" | "system";
}

export function OnboardingThemePreview({ variant }: OnboardingThemePreviewProps) {
  return (
    <div className="relative h-28 overflow-hidden rounded-lg border border-border">
      {variant === "system" ? (
        <>
          {windowMock(PALETTES.light)}
          {windowMock(PALETTES.dark, "[clip-path:polygon(100%_0,100%_100%,0_100%)]")}
        </>
      ) : (
        windowMock(PALETTES[variant])
      )}
    </div>
  );
}
