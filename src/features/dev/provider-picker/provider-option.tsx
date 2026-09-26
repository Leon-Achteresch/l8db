import { Check } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import type { ProviderInfo } from "@/lib/db";
import { cn } from "@/lib/utils";

export function ProviderOption({
  provider,
  selected,
  onSelect,
  note,
  size = "row",
}: {
  provider: ProviderInfo;
  selected: boolean;
  onSelect: () => void;
  note?: string;
  size?: "row" | "chip" | "card";
}) {
  const unavailable = !provider.driver_status.available;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={unavailable}
      onClick={onSelect}
      title={unavailable ? `${provider.name}: Treiber fehlt` : provider.name}
      className={cn(
        "group flex min-w-0 items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45",
        size === "row" && "h-10 gap-2.5 rounded-lg px-2.5 hover:bg-muted",
        size === "chip" && "h-8 gap-1.5 rounded-full border bg-card pl-1.5 pr-3 hover:bg-muted",
        size === "card" &&
          "gap-3 rounded-xl border bg-card p-3 hover:border-foreground/20 hover:bg-muted/50",
        selected &&
          (size === "row"
            ? "bg-primary/10 text-foreground hover:bg-primary/10"
            : "border-primary/50 bg-primary/5 ring-1 ring-primary/30"),
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-lg bg-background ring-1 ring-border/70",
          size === "card" ? "size-10" : size === "chip" ? "size-5 rounded-full" : "size-7",
        )}
      >
        <ProviderLogo
          providerId={provider.id}
          kind={provider.kind}
          className={size === "card" ? "size-6" : size === "chip" ? "size-3.5" : "size-4.5"}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium", size === "card" ? "text-sm" : "text-xs")}>
          {provider.name}
        </span>
        {note && size !== "chip" && (
          <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
        )}
      </span>
      {unavailable && size !== "chip" && (
        <span className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-300">
          Treiber fehlt
        </span>
      )}
      {selected && size !== "chip" && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}
