import { useState } from "react";
import { cn } from "@/lib/utils";
import { SettingsLabClassic } from "./settings-lab-classic";
import { type SettingsLabValues, settingsLabCategories } from "./settings-lab-data";
import { SettingsLabInspector } from "./settings-lab-inspector";
import { SettingsLabOverview } from "./settings-lab-overview";
import { SettingsLabToolbar } from "./settings-lab-toolbar";

const variants = [
  {
    id: "classic",
    number: "01",
    name: "Ruhige Seitenleiste",
    description: "Klare Navigation links, großzügiger Lesebereich rechts.",
    component: SettingsLabClassic,
  },
  {
    id: "toolbar",
    number: "02",
    name: "Werkzeugansicht",
    description: "Kategorien oben, kompakte Einstellungszeilen darunter.",
    component: SettingsLabToolbar,
  },
  {
    id: "overview",
    number: "03",
    name: "Kachel-Übersicht",
    description: "Alle Bereiche auf einen Blick, Optionen in Karten.",
    component: SettingsLabOverview,
  },
  {
    id: "inspector",
    number: "04",
    name: "Inspector",
    description: "Schmale Icon-Navigation und Kontext neben den Optionen.",
    component: SettingsLabInspector,
  },
] as const;

export function SettingsDesignLab() {
  const [variant, setVariant] = useState<(typeof variants)[number]["id"]>("classic");
  const [categoryId, setCategoryId] =
    useState<(typeof settingsLabCategories)[number]["id"]>("general");
  const [values, setValues] = useState<SettingsLabValues>({
    theme: "System",
    density: "Komfortabel",
    limit: "100",
    timeout: "30 s",
    font: "14 px",
    keymap: "Standard",
    hostkey: true,
    keychain: true,
    confirm: true,
    autoupdate: true,
  });
  const currentVariant = variants.find((item) => item.id === variant) ?? variants[0];
  const category =
    settingsLabCategories.find((item) => item.id === categoryId) ?? settingsLabCategories[0];
  const Preview = currentVariant.component;

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Einstellungen neu denken</h2>
        <p className="text-sm text-muted-foreground">
          Vier Layouts für dieselben Einstellungsbereiche. Kategorien und Beispieloptionen lassen
          sich direkt in der Vorschau ausprobieren.
        </p>
      </div>
      <fieldset
        className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Designvariante wählen"
      >
        {variants.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={variant === item.id}
            onClick={() => setVariant(item.id)}
            className={cn(
              "min-h-28 rounded-xl border bg-card px-4 py-4 text-left transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              variant === item.id && "border-primary bg-primary/5 ring-1 ring-primary/20",
            )}
          >
            <span className="font-mono text-xs text-primary">{item.number}</span>
            <span className="mt-2 block text-sm font-semibold">{item.name}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {item.description}
            </span>
          </button>
        ))}
      </fieldset>
      <section
        aria-label={`Vorschau: ${currentVariant.name}`}
        className="overflow-hidden rounded-xl border bg-card shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5 text-xs">
          <span className="font-medium">
            {currentVariant.number} / {currentVariant.name}
          </span>
          <span className="text-muted-foreground">
            Interaktive Vorschau · Änderungen werden nicht gespeichert
          </span>
        </div>
        <Preview
          category={category}
          onCategoryChange={setCategoryId}
          values={values}
          onValueChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
        />
      </section>
    </div>
  );
}
