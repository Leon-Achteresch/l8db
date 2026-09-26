import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import type { ProviderInfo } from "@/lib/db";
import { CATEGORIES, type CategoryId, categoryOf, POPULAR_IDS } from "./categories";
import { ProviderOption } from "./provider-option";

export function GuidedPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: ProviderInfo[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [category, setCategory] = useState<CategoryId | null>(null);
  const current = CATEGORIES.find((entry) => entry.id === category);

  if (!current) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold">Wo liegen deine Daten?</p>
          <p className="text-xs text-muted-foreground">
            Wähle, was am ehesten passt. Die konkrete Datenbank kommt im nächsten Schritt.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((entry) => {
            const members = providers.filter((provider) => categoryOf(provider) === entry.id);
            if (!members.length) return null;
            const examples = [
              ...new Set([
                ...members.filter((provider) => POPULAR_IDS.includes(provider.id)),
                ...members,
              ]),
            ].slice(0, 3);
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setCategory(entry.id)}
                className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <entry.icon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block text-sm font-medium">{entry.question}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {entry.description}
                  </span>
                  <span className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                    <span className="flex -space-x-1.5">
                      {examples.map((provider) => (
                        <span
                          key={provider.id}
                          className="grid size-5 place-items-center rounded-full bg-background ring-2 ring-card"
                        >
                          <ProviderLogo
                            providerId={provider.id}
                            kind={provider.kind}
                            className="size-3.5"
                          />
                        </span>
                      ))}
                    </span>
                    {members.length} Datenbanken
                  </span>
                </span>
                <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const members = providers.filter((provider) => categoryOf(provider) === current.id);
  const groups = [...new Set(members.map((provider) => provider.group))];
  return (
    <div className="space-y-3 animate-in fade-in-0 slide-in-from-right-2 duration-200">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCategory(null)}
          aria-label="Zurück zur Auswahl"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{current.title}</p>
          <p className="truncate text-xs text-muted-foreground">Welche Datenbank genau?</p>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group} className="space-y-1">
          {groups.length > 1 && (
            <p className="px-2.5 text-[11px] font-medium text-muted-foreground">{group}</p>
          )}
          <div className="grid gap-0.5 sm:grid-cols-2">
            {members
              .filter((provider) => provider.group === group)
              .map((provider) => (
                <ProviderOption
                  key={provider.id}
                  provider={provider}
                  selected={selected === provider.id}
                  onSelect={() => onSelect(provider.id)}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
