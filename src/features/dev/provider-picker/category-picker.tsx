import { Star } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import {
  CATEGORIES,
  type CategoryId,
  categoryOf,
  connectionNeeds,
  POPULAR_IDS,
  POPULAR_NOTES,
} from "@/features/connections/provider-picker/categories";
import { ProviderOption } from "@/features/connections/provider-picker/provider-option";
import type { ProviderInfo } from "@/lib/db";
import { cn } from "@/lib/utils";

export function CategoryPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: ProviderInfo[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [category, setCategory] = useState<CategoryId | "popular">("popular");
  const sections = [
    { id: "popular" as const, title: "Beliebt", icon: Star },
    ...CATEGORIES.filter((entry) =>
      providers.some((provider) => categoryOf(provider) === entry.id),
    ),
  ];
  const members =
    category === "popular"
      ? POPULAR_IDS.flatMap((id) => providers.find((provider) => provider.id === id) ?? [])
      : providers.filter((provider) => categoryOf(provider) === category);
  const description = CATEGORIES.find((entry) => entry.id === category)?.description;
  const active = providers.find((provider) => provider.id === selected);

  return (
    <div className="grid min-h-[340px] overflow-hidden rounded-xl border bg-card sm:grid-cols-[200px_1fr]">
      <nav
        aria-label="Kategorien"
        className="flex gap-0.5 overflow-x-auto border-b bg-muted/30 p-1.5 sm:flex-col sm:border-b-0 sm:border-r"
      >
        {sections.map((entry) => {
          const count =
            entry.id === "popular"
              ? POPULAR_IDS.length
              : providers.filter((provider) => categoryOf(provider) === entry.id).length;
          return (
            <button
              key={entry.id}
              type="button"
              aria-current={category === entry.id}
              onClick={() => setCategory(entry.id)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                category === entry.id
                  ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border/70"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <entry.icon className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">{entry.title}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-col">
        <div className="flex-1 space-y-2 p-3">
          <p className="px-1 text-xs text-muted-foreground">
            {description ?? "Die sechs Datenbanken, mit denen die meisten anfangen."}
          </p>
          <div className="grid gap-0.5 md:grid-cols-2">
            {members.map((provider) => (
              <ProviderOption
                key={provider.id}
                provider={provider}
                note={category === "popular" ? POPULAR_NOTES[provider.id] : undefined}
                selected={selected === provider.id}
                onSelect={() => onSelect(provider.id)}
              />
            ))}
          </div>
        </div>
        <div className="border-t bg-muted/20 p-3">
          {active ? (
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background ring-1 ring-border/70">
                <ProviderLogo providerId={active.id} kind={active.kind} className="size-5" />
              </span>
              <div className="min-w-0 space-y-1 text-xs">
                <p className="font-semibold">
                  {active.name}
                  <span className="ml-2 font-normal text-muted-foreground">{active.group}</span>
                </p>
                <p className="line-clamp-2 leading-5 text-muted-foreground">{active.hint}</p>
                <p>
                  <span className="text-muted-foreground">Du brauchst: </span>
                  {connectionNeeds(active)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Wähle eine Datenbank, um zu sehen, was du zum Verbinden brauchst.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
