import { cn } from "@/lib/utils";
import type { SettingsLabVariantProps } from "./settings-lab-data";

interface Props extends Pick<SettingsLabVariantProps, "category" | "values" | "onValueChange"> {
  style?: "cards" | "rows" | "lines";
}

export function SettingsLabOptions({ category, values, onValueChange, style = "rows" }: Props) {
  return (
    <div
      className={cn(style === "cards" ? "grid gap-3 md:grid-cols-2" : "divide-y divide-border/70")}
    >
      {category.options.map((option) => {
        const value = values[option.id] ?? (option.kind === "toggle" ? false : option.choices[0]);
        return (
          <div
            key={option.id}
            className={cn(
              "flex min-w-0 flex-wrap items-center justify-between gap-4 py-4 sm:flex-nowrap",
              style === "cards" &&
                "min-h-36 flex-col items-start rounded-xl border bg-background/80 p-5",
              style === "lines" && "py-3",
            )}
          >
            <div className="min-w-0 max-w-md space-y-1">
              <p className="text-sm font-medium text-foreground">{option.label}</p>
              <p className="text-xs leading-5 text-muted-foreground">{option.description}</p>
            </div>
            {option.kind === "toggle" ? (
              <button
                type="button"
                role="switch"
                aria-label={option.label}
                aria-checked={Boolean(value)}
                onClick={() => onValueChange(option.id, !value)}
                className={cn(
                  "relative h-6 w-10 shrink-0 rounded-full bg-muted-foreground/35 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  value && "bg-primary",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
                    value && "translate-x-4",
                  )}
                />
              </button>
            ) : (
              <fieldset
                className="flex max-w-full flex-wrap gap-1 rounded-lg bg-muted/70 p-1"
                aria-label={option.label}
              >
                {option.choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={value === choice}
                    onClick={() => onValueChange(option.id, choice)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      value === choice
                        ? "bg-background font-medium text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {choice}
                  </button>
                ))}
              </fieldset>
            )}
          </div>
        );
      })}
    </div>
  );
}
