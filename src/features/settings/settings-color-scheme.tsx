import { useTheme } from "next-themes";
import { useId } from "react";
import { ColorSchemePreview } from "@/features/settings/color-scheme-preview";
import { appTheme } from "@/lib/app-themes";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

const SCHEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
] as const;

export function SettingsColorScheme() {
  const { theme, setTheme } = useTheme();
  const name = useId();
  const light = appTheme(useSettingsStore((state) => state.lightTheme)).light;
  const dark = appTheme(useSettingsStore((state) => state.darkTheme)).dark;
  const current = theme ?? "system";
  return (
    <div
      role="radiogroup"
      aria-label="Farbschema"
      className="grid w-full grid-cols-1 gap-3 @min-[30rem]:grid-cols-3"
    >
      {SCHEMES.map((scheme) => {
        const selected = scheme.value === current;
        return (
          <label
            key={scheme.value}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-2 transition-[border-color,box-shadow] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60",
              selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/30",
            )}
          >
            <input
              type="radio"
              name={name}
              value={scheme.value}
              checked={selected}
              onChange={() => setTheme(scheme.value)}
              className="sr-only"
            />
            <div className="relative aspect-[16/7] overflow-hidden rounded-lg border border-border/70">
              {scheme.value === "dark" ? null : (
                <ColorSchemePreview mode="light" variant={light} className="absolute inset-0" />
              )}
              {scheme.value === "light" ? null : (
                <ColorSchemePreview
                  mode="dark"
                  variant={dark}
                  className="absolute inset-0"
                  style={scheme.value === "system" ? { clipPath: "inset(0 0 0 50%)" } : undefined}
                />
              )}
            </div>
            <span
              className={cn(
                "text-center text-xs",
                selected ? "font-medium" : "text-muted-foreground",
              )}
            >
              {scheme.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
