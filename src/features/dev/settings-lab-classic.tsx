import { cn } from "@/lib/utils";
import { type SettingsLabVariantProps, settingsLabCategories } from "./settings-lab-data";
import { SettingsLabOptions } from "./settings-lab-options";

export function SettingsLabClassic({
  category,
  onCategoryChange,
  values,
  onValueChange,
}: SettingsLabVariantProps) {
  return (
    <div className="grid min-h-[560px] md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b bg-muted/35 p-5 md:border-b-0 md:border-r">
        <p className="mb-5 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Einstellungen
        </p>
        <nav
          className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-1"
          aria-label="Kategorien der klassischen Vorschau"
        >
          {settingsLabCategories.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onCategoryChange(item.id)}
                aria-current={item.id === category.id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  item.id === category.id &&
                    "bg-background font-semibold text-foreground shadow-xs",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 px-6 py-7 sm:px-9">
        <div className="mb-10 flex flex-wrap items-start justify-between gap-4 border-b pb-7">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Einstellungen / {category.label}</p>
            <h3 className="text-2xl font-semibold tracking-tight">{category.label}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{category.description}</p>
          </div>
        </div>
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Optionen
          </p>
          <SettingsLabOptions category={category} values={values} onValueChange={onValueChange} />
        </div>
      </div>
    </div>
  );
}
