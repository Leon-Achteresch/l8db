import { MoonIcon, SunIcon } from "lucide-react";
import { type ThemeMode, type ThemeVariant, themeSwatch } from "@/lib/app-themes";
import { cn } from "@/lib/utils";

type Props = {
  mode: ThemeMode;
  variant: ThemeVariant;
  themeName: string;
  selected: boolean;
  onSelect: () => void;
};

export function ThemeSwatchButton({ mode, variant, themeName, selected, onSelect }: Props) {
  const Icon = mode === "light" ? SunIcon : MoonIcon;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${themeName} für ${mode === "light" ? "hellen" : "dunklen"} Modus`}
      title={`${themeName} · ${mode === "light" ? "Hell" : "Dunkel"}`}
      onClick={onSelect}
      className={cn(
        "relative rounded-full p-1 outline-none ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60",
        selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-border",
      )}
    >
      <span
        className="block size-12 rounded-full border border-black/5 shadow-sm dark:border-white/10"
        style={{ background: themeSwatch(variant, mode) }}
      />
      {selected ? (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border bg-background text-foreground shadow-sm">
          <Icon className="size-3" />
        </span>
      ) : null}
    </button>
  );
}
