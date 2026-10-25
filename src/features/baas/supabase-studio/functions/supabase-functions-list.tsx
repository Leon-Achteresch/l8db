import { useQuery } from "@tanstack/react-query";
import { Code2, Plus, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sidebarMenuButtonVariants } from "@/components/ui/sidebar/shared";
import { supabaseFunctions } from "@/lib/db";
import { cn } from "@/lib/utils";
import { statusLabel } from "../supabase-services";
import { FUNCTION_SLUG, useSupabaseFunctionSlugs } from "./supabase-functions-store";

const EMPTY: string[] = [];

export function SupabaseFunctionsList({
  reference,
  cloud,
  selected,
  onSelect,
}: {
  reference: string;
  cloud: boolean;
  selected: string | null;
  onSelect: (slug: string | null) => void;
}) {
  const functions = useQuery({
    queryKey: ["supabase", reference, "functions"],
    queryFn: () => supabaseFunctions(reference),
    enabled: cloud,
  });
  const known = useSupabaseFunctionSlugs((state) => state.slugs[reference] ?? EMPTY);
  const add = useSupabaseFunctionSlugs((state) => state.add);
  const remove = useSupabaseFunctionSlugs((state) => state.remove);
  const [slug, setSlug] = useState("");
  const valid = FUNCTION_SLUG.test(slug.trim());
  const items = cloud
    ? (functions.data ?? []).map((item) => ({
        slug: item.slug,
        label: item.name && item.name !== item.slug ? item.name : null,
        status: item.status,
        version: item.version,
      }))
    : known.map((item) => ({ slug: item, label: null, status: null, version: null }));

  return (
    <div className="space-y-2">
      {cloud ? (
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            {functions.data ? `${functions.data.length} Funktionen` : "Funktionen"}
          </p>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Funktionen neu laden"
            disabled={functions.isFetching}
            onClick={() => void functions.refetch()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            add(reference, slug.trim());
            onSelect(slug.trim());
            setSlug("");
          }}
        >
          <Input
            className="h-8 text-xs"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="Function-Slug"
            aria-label="Function-Slug hinzufügen"
          />
          <Button size="icon-sm" type="submit" disabled={!valid} aria-label="Slug hinzufügen">
            <Plus className="size-3.5" />
          </Button>
        </form>
      )}
      {functions.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(functions.error)}
        </p>
      )}
      {cloud && functions.isLoading && (
        <p className="text-xs text-muted-foreground">Funktionen werden geladen…</p>
      )}
      {items.length === 0 && !functions.isLoading && !functions.isError && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {cloud
            ? "Noch keine Edge Functions. Lege eine neue an."
            : "Selbst gehostet gibt es keine Liste. Füge bekannte Slugs hinzu (z. B. hello)."}
        </p>
      )}
      <ul className="grid gap-0.5">
        {items.map((item) => (
          <li key={item.slug} className="group flex items-center gap-1">
            <button
              type="button"
              aria-current={selected === item.slug ? "true" : undefined}
              onClick={() => onSelect(item.slug)}
              data-active={selected === item.slug || undefined}
              className={cn(sidebarMenuButtonVariants(), "h-auto min-h-7 min-w-0 flex-1 text-xs")}
            >
              <Code2 className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {item.slug}
                {item.label && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.label}
                  </span>
                )}
              </span>
              {item.version != null && (
                <span className="text-[10px] text-muted-foreground">v{item.version}</span>
              )}
              {item.status && item.status !== "ACTIVE" && (
                <Badge variant="outline">{statusLabel(item.status)}</Badge>
              )}
            </button>
            {!cloud && (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`${item.slug} entfernen`}
                onClick={() => {
                  remove(reference, item.slug);
                  if (selected === item.slug) onSelect(null);
                }}
              >
                <X className="size-3" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
