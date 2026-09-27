import { Check, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import { type SettingsLabVariantProps, settingsLabCategories } from "./settings-lab-data";
import { SettingsLabOptions } from "./settings-lab-options";

export function SettingsLabInspector({
  category,
  onCategoryChange,
  values,
  onValueChange,
}: SettingsLabVariantProps) {
  return (
    <div className="grid min-h-[560px] md:grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[72px_minmax(0,1fr)_220px]">
      <nav
        className="flex gap-1 overflow-x-auto border-b bg-muted/40 p-3 md:flex-col md:items-center md:border-b-0 md:border-r"
        aria-label="Kategorien des Inspectors"
      >
        <div className="mb-2 hidden size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground md:flex">
          <Command className="size-4" />
        </div>
        {settingsLabCategories.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-current={item.id === category.id ? "page" : undefined}
              onClick={() => onCategoryChange(item.id)}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                item.id === category.id && "bg-primary/12 text-primary",
              )}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </nav>
      <section className="min-w-0 px-6 py-7 sm:px-9">
        <div className="mb-8">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            SETTINGS / {category.id}
          </p>
          <h3 className="text-2xl font-semibold tracking-tight">{category.label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{category.description}</p>
        </div>
        <div className="max-w-3xl">
          <SettingsLabOptions
            category={category}
            values={values}
            onValueChange={onValueChange}
            style="lines"
          />
        </div>
      </section>
      <aside className="hidden border-l bg-muted/20 p-6 xl:block">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Kontext
        </p>
        <h4 className="mt-5 text-sm font-semibold">{category.label}</h4>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {category.description}. Änderungen in dieser Vorschau bleiben lokal.
        </p>
        <div className="mt-7 space-y-3 border-t pt-5">
          <p className="text-xs font-medium">In diesem Bereich</p>
          {category.options.map((option) => (
            <div key={option.id} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="mt-0.5 size-3 shrink-0 text-primary" />
              {option.label}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
