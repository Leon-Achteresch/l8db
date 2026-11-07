import { ArrowRight, ClipboardPaste, Sparkles } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { detectProvider, kindFromUrl } from "@/lib/connection-url";
import type { ProviderInfo } from "@/lib/db";
import { CATEGORIES, type CategoryId, categoryOf, matchesProvider } from "./categories";
import { ProviderOption } from "./provider-option";

export function SmartPicker({
  providers,
  selected,
  onSelect,
  onPaste,
  hiddenIds = [],
  extras = [],
}: {
  providers: ProviderInfo[];
  selected: string;
  onSelect: (id: string) => void;
  onPaste?: (url: string) => void;
  hiddenIds?: string[];
  extras?: { id: string; name: string; category: CategoryId; onSelect: () => void }[];
}) {
  const [value, setValue] = useState("");
  const kind = value.trim().length > 2 ? kindFromUrl(value) : undefined;
  const detected = kind
    ? providers.find((provider) => provider.id === detectProvider(value, kind))
    : undefined;
  const filtered = providers.filter(
    (provider) =>
      !hiddenIds.includes(provider.id) && (detected || matchesProvider(provider, value)),
  );
  const needle = value.trim().toLowerCase();
  const filteredExtras = extras.filter(
    (extra) => extra.id.includes(needle) || extra.name.toLowerCase().includes(needle),
  );

  function continueWithDetected() {
    if (!detected) return;
    if (onPaste) onPaste(value.trim());
    else onSelect(detected.id);
  }

  async function paste() {
    const text = await navigator.clipboard.readText().catch(() => "");
    if (text) setValue(text.trim());
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex h-11 items-center gap-2 rounded-lg border bg-background pl-3 pr-1 focus-within:ring-2 focus-within:ring-ring">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const available = filtered.filter((provider) => provider.driver_status.available);
              const exact = available.find(
                (provider) => provider.id === needle || provider.name.toLowerCase() === needle,
              );
              const extra = filteredExtras.find(
                (item) => item.id === needle || item.name.toLowerCase() === needle,
              );
              const single = available.length === 1 && !filteredExtras.length;
              if (detected) continueWithDetected();
              else if (needle && exact) onSelect(exact.id);
              else if (needle && extra) extra.onSelect();
              else if (needle && single) onSelect(available[0].id);
            }}
            placeholder="Verbindungs-URL einfügen oder Namen tippen"
            aria-label="Verbindungs-URL oder Datenbankname"
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground"
          />
          <Button type="button" variant="ghost" size="sm" onClick={paste} className="text-xs">
            <ClipboardPaste className="size-3.5" />
            Einfügen
          </Button>
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">
          Die URL findest du meist im Dashboard deines Anbieters unter „Connect“ oder „Connection
          string“.
        </p>
      </div>
      {detected ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 animate-in fade-in-0 zoom-in-95 duration-200">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-background ring-1 ring-border/70">
            <ProviderLogo providerId={detected.id} kind={detected.kind} className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Erkannt: {detected.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              Host, Benutzer und Datenbank werden aus der URL übernommen.
            </p>
          </div>
          <Button type="button" size="sm" onClick={continueWithDetected}>
            Weiter mit {detected.name}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {CATEGORIES.map((category) => {
            const members = filtered.filter((provider) => categoryOf(provider) === category.id);
            const extraMembers = filteredExtras.filter((extra) => extra.category === category.id);
            if (!members.length && !extraMembers.length) return null;
            return (
              <div key={category.id} className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <category.icon className="size-3" />
                  {category.title}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((provider) => (
                    <ProviderOption
                      key={provider.id}
                      size="chip"
                      provider={provider}
                      selected={selected === provider.id}
                      onSelect={() => onSelect(provider.id)}
                    />
                  ))}
                  {extraMembers.map((extra) => (
                    <button
                      key={extra.id}
                      type="button"
                      onClick={extra.onSelect}
                      title={extra.name}
                      className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border bg-card pr-3 pl-1.5 text-left text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background ring-1 ring-border/70">
                        <ProviderLogo providerId={extra.id} className="size-3.5" />
                      </span>
                      <span className="truncate">{extra.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {!filtered.length && !filteredExtras.length && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Keine Datenbank mit diesem Namen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
