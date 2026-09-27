import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type SettingsLabVariantProps, settingsLabCategories } from "./settings-lab-data";
import { SettingsLabOptions } from "./settings-lab-options";

export function SettingsLabOverview({
  category,
  onCategoryChange,
  values,
  onValueChange,
}: SettingsLabVariantProps) {
  const Icon = category.icon;
  return (
    <div className="min-h-[560px] bg-muted/30 px-5 py-7 sm:px-8">
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-medium text-primary">DEIN ARBEITSBEREICH</p>
        <h3 className="mt-2 text-3xl font-semibold tracking-tight">Einstellungen</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Alles für deinen Workflow, an einem Ort.
        </p>
      </div>
      <nav
        className="mb-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Kategorien der Kachelübersicht"
      >
        {settingsLabCategories.map((item) => {
          const TileIcon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onCategoryChange(item.id)}
              aria-current={item.id === category.id ? "page" : undefined}
              className={cn(
                "group flex min-h-28 flex-col justify-between rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                item.id === category.id && "border-primary/50 bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between">
                <TileIcon className="size-5 text-primary" />
                <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div>
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
              </div>
            </button>
          );
        })}
      </nav>
      <section
        className="rounded-2xl border bg-card p-5 sm:p-7"
        aria-label={`${category.label} Vorschau`}
      >
        <div className="mb-4 flex items-center gap-3 border-b pb-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <div>
            <h4 className="font-semibold">{category.label}</h4>
            <p className="text-xs text-muted-foreground">{category.description}</p>
          </div>
        </div>
        <SettingsLabOptions
          category={category}
          values={values}
          onValueChange={onValueChange}
          style="cards"
        />
      </section>
    </div>
  );
}
