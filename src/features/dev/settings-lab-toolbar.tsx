import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { type SettingsLabVariantProps, settingsLabCategories } from "./settings-lab-data";
import { SettingsLabOptions } from "./settings-lab-options";

export function SettingsLabToolbar({
  category,
  onCategoryChange,
  values,
  onValueChange,
}: SettingsLabVariantProps) {
  return (
    <div className="min-h-[560px] bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="size-4" /> Einstellungen
        </div>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          L8DB / PREFERENCES
        </span>
      </div>
      <nav
        className="flex gap-1 overflow-x-auto border-b bg-muted/25 px-5 pt-3 sm:px-8"
        aria-label="Kategorien der Werkzeugansicht"
      >
        {settingsLabCategories.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onCategoryChange(item.id)}
            aria-current={item.id === category.id ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 border-transparent px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              item.id === category.id && "border-primary font-semibold text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{category.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{category.description}</p>
          </div>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {String(category.options.length).padStart(2, "0")} OPTIONEN
          </span>
        </div>
        <div className="rounded-lg border bg-card px-5 sm:px-7">
          <SettingsLabOptions
            category={category}
            values={values}
            onValueChange={onValueChange}
            style="lines"
          />
        </div>
      </div>
    </div>
  );
}
