import { useState } from "react";
import { SmartPicker } from "@/features/connections/provider-picker/smart-picker";
import { useProvidersStore } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { CategoryPicker } from "./provider-picker/category-picker";
import { GuidedPicker } from "./provider-picker/guided-picker";
import { PopularPicker } from "./provider-picker/popular-picker";

const variants = [
  {
    id: "guided",
    title: "01 · Geführte Frage",
    description:
      "Erst eine verständliche Frage („Wo liegen deine Daten?“), dann nur die passenden Datenbanken. Keine Fachbegriffe im ersten Schritt.",
    Picker: GuidedPicker,
  },
  {
    id: "popular",
    title: "02 · Beliebt zuerst",
    description:
      "Sechs große Karten mit Einsatzzweck decken die meisten Fälle ab. Suche oben, der Rest klappt alphabetisch auf.",
    Picker: PopularPicker,
  },
  {
    id: "category",
    title: "03 · Kategorien mit Details",
    description:
      "Einstellungs-Layout: links Kategorien, rechts ruhige Zeilen. Unten steht, was man zum Verbinden braucht.",
    Picker: CategoryPicker,
  },
  {
    id: "smart",
    title: "04 · URL einfügen oder suchen",
    description:
      "Ein Feld für alles: Eine eingefügte URL wird automatisch erkannt, Text filtert kompakte Chips nach Kategorie.",
    Picker: SmartPicker,
  },
] as const;

export function ProviderPickerLab() {
  const providers = useProvidersStore((state) => state.providers);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Datenbank auswählen</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vier Entwürfe für den ersten Schritt im Verbindungsdialog, mit den echten{" "}
            {providers.length} Providern aus der Registry.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelection({});
            setRevision(revision + 1);
          }}
          className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          Zurücksetzen
        </button>
      </div>
      <div className="grid gap-6 2xl:grid-cols-2">
        {variants.map(({ id, title, description, Picker }) => {
          const chosen = providers.find((provider) => provider.id === selection[id]);
          return (
            <section key={id} aria-label={title} className="min-w-0 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-sidebar/45 p-4 sm:p-6">
                <div className="mx-auto w-full max-w-[720px] space-y-4">
                  <Picker
                    key={revision}
                    providers={providers}
                    selected={selection[id] ?? ""}
                    onSelect={(value) => setSelection({ ...selection, [id]: value })}
                  />
                  <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs">
                    <span className={cn("truncate", !chosen && "text-muted-foreground")}>
                      {chosen ? `Ausgewählt: ${chosen.name}` : "Noch keine Auswahl"}
                    </span>
                    <span
                      className={cn(
                        "rounded-md px-3 py-1.5 font-medium",
                        chosen
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      Weiter
                    </span>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
