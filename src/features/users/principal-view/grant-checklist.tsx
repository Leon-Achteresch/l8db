import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MAX_GRANT_ROWS } from "@/features/users/principal-view/object-privileges";
import type { GrantFlags } from "@/features/users/principal-view/principal-draft";
import { cn } from "@/lib/utils";

interface GrantChecklistProps {
  items: { name: string; system?: boolean }[];
  value: Record<string, GrantFlags>;
  original: Record<string, GrantFlags>;
  onChange: (value: Record<string, GrantFlags>) => void;
  withDefault?: boolean;
  placeholder: string;
}

export function GrantChecklist({
  items,
  value,
  original,
  onChange,
  withDefault = false,
  placeholder,
}: GrantChecklistProps) {
  const granted = Object.keys(value).length;
  const [scope, setScope] = useState<"granted" | "all">(granted > 0 ? "granted" : "all");
  const [filter, setFilter] = useState("");

  const names = useMemo(() => {
    const known = new Map(items.map((item) => [item.name, item.system ?? false]));
    for (const name of Object.keys(original)) if (!known.has(name)) known.set(name, false);
    return [...known].map(([name, system]) => ({ name, system }));
  }, [items, original]);

  const needle = filter.trim().toUpperCase();
  const visible = names.filter(
    ({ name }) =>
      (scope === "all" || name in value || name in original) && name.toUpperCase().includes(needle),
  );

  const set = (name: string, flags: GrantFlags | null) => {
    const next = { ...value };
    if (flags) next[name] = flags;
    else delete next[name];
    onChange(next);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={placeholder}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <div className="flex rounded-full bg-muted/60 p-0.5">
          {(["granted", "all"] as const).map((option) => (
            <Button
              key={option}
              size="xs"
              variant={scope === option ? "secondary" : "ghost"}
              aria-pressed={scope === option}
              className={cn("rounded-full", scope === option && "bg-background shadow-xs")}
              onClick={() => setScope(option)}
            >
              {option === "granted" ? `Erteilt ${granted}` : `Alle ${names.length}`}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex h-6 items-center gap-2.5 px-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        <span className="flex-1" />
        <span className="w-14 text-center">Admin</span>
        {withDefault && <span className="w-14 text-center">Default</span>}
      </div>
      <div className="flex flex-col">
        {visible.slice(0, MAX_GRANT_ROWS).map(({ name, system }) => {
          const now = value[name];
          const before = original[name];
          const changed =
            Boolean(now) !== Boolean(before) ||
            (now &&
              before &&
              (now.admin !== before.admin || (withDefault && now.default !== before.default)));
          return (
            <div
              key={name}
              className="flex h-8 items-center gap-2.5 rounded-lg px-2 hover:bg-muted/50"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={Boolean(now)}
                  onCheckedChange={(on) =>
                    set(name, on === true ? (before ?? { admin: false, default: true }) : null)
                  }
                />
                <span
                  className={cn(
                    "truncate font-mono text-xs",
                    system && "text-muted-foreground",
                    !now && before && "line-through",
                  )}
                >
                  {name}
                </span>
                {changed && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
              </label>
              <span className="flex w-14 justify-center">
                <Checkbox
                  aria-label={`${name}: Admin`}
                  disabled={!now}
                  checked={now?.admin ?? false}
                  onCheckedChange={(on) => now && set(name, { ...now, admin: on === true })}
                />
              </span>
              {withDefault && (
                <span className="flex w-14 justify-center">
                  <Checkbox
                    aria-label={`${name}: Default`}
                    disabled={!now}
                    checked={now?.default ?? false}
                    onCheckedChange={(on) => now && set(name, { ...now, default: on === true })}
                  />
                </span>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="px-2 py-3 text-[13px] text-muted-foreground">Keine Treffer.</p>
        )}
        {visible.length > MAX_GRANT_ROWS && (
          <p className="px-2 py-2 text-xs text-muted-foreground tabular-nums">
            {MAX_GRANT_ROWS} von {visible.length}
          </p>
        )}
      </div>
    </div>
  );
}
