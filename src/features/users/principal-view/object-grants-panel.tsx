import { SearchIcon, UndoIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ObjectGrantForm } from "@/features/users/principal-view/object-grant-form";
import { MAX_GRANT_ROWS } from "@/features/users/principal-view/object-privileges";
import { objectGrantKey } from "@/features/users/principal-view/principal-draft";
import type { ObjectGrant } from "@/lib/db";
import { cn } from "@/lib/utils";

interface ObjectGrantsPanelProps {
  grants: ObjectGrant[];
  original: ObjectGrant[];
  truncated: boolean;
  owners: string[];
  allowGrantOption: boolean;
  onChange: (grants: ObjectGrant[]) => void;
}

type RowState = "same" | "added" | "changed" | "removed";

export function ObjectGrantsPanel({
  grants,
  original,
  truncated,
  owners,
  allowGrantOption,
  onChange,
}: ObjectGrantsPanelProps) {
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const before = new Map(original.map((grant) => [objectGrantKey(grant), grant]));
    const now = new Map(grants.map((grant) => [objectGrantKey(grant), grant]));
    const added = grants
      .filter((grant) => !before.has(objectGrantKey(grant)))
      .map((grant) => ({ grant, state: "added" as RowState }));
    const known = original.map((grant) => {
      const current = now.get(objectGrantKey(grant));
      if (!current) return { grant, state: "removed" as RowState };
      return {
        grant: current,
        state: (current.grantable === grant.grantable ? "same" : "changed") as RowState,
      };
    });
    return [...added, ...known];
  }, [grants, original]);

  const needle = filter.trim().toUpperCase();
  const visible = needle
    ? rows.filter(({ grant }) =>
        `${grant.owner}.${grant.object} ${grant.privilege} ${grant.object_type}`
          .toUpperCase()
          .includes(needle),
      )
    : rows;

  const add = (items: ObjectGrant[]) => {
    const taken = new Set(grants.map(objectGrantKey));
    onChange([...items.filter((item) => !taken.has(objectGrantKey(item))), ...grants]);
  };

  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <ObjectGrantForm owners={owners} allowGrantOption={allowGrantOption} onAdd={add} />
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Objekt oder Recht filtern"
          className="h-8 pl-8 text-[13px]"
        />
      </div>
      <div className="flex flex-col">
        <div className="flex h-6 items-center gap-3 px-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          <span className="flex-1">Objekt</span>
          <span className="w-24">Typ</span>
          <span className="w-28">Recht</span>
          {allowGrantOption && <span className="w-14 text-center">Grant</span>}
          <span className="w-28">Grantor</span>
          <span className="w-6" />
        </div>
        {visible.slice(0, MAX_GRANT_ROWS).map(({ grant, state }) => {
          const key = objectGrantKey(grant);
          return (
            <div
              key={key}
              className={cn(
                "flex h-8 items-center gap-3 rounded-lg px-2 text-xs hover:bg-muted/50",
                state === "removed" && "text-muted-foreground line-through",
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-mono">
                  <span className="text-muted-foreground">{grant.owner}.</span>
                  {grant.object}
                  {grant.column && <span className="text-muted-foreground"> ({grant.column})</span>}
                </span>
                {state !== "same" && state !== "removed" && (
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                )}
              </span>
              <span className="w-24 truncate text-muted-foreground">{grant.object_type}</span>
              <span className="w-28 truncate font-mono">{grant.privilege}</span>
              {allowGrantOption && (
                <span className="flex w-14 justify-center">
                  <Checkbox
                    aria-label="Grant Option"
                    disabled={state === "removed"}
                    checked={grant.grantable}
                    onCheckedChange={(on) =>
                      onChange(
                        grants.map((item) =>
                          objectGrantKey(item) === key ? { ...item, grantable: on === true } : item,
                        ),
                      )
                    }
                  />
                </span>
              )}
              <span className="w-28 truncate text-muted-foreground">{grant.grantor}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={state === "removed" ? "Wiederherstellen" : "Entziehen"}
                onClick={() =>
                  onChange(
                    state === "removed"
                      ? [...grants, grant]
                      : grants.filter((item) => objectGrantKey(item) !== key),
                  )
                }
              >
                {state === "removed" ? <UndoIcon /> : <XIcon />}
              </Button>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="px-2 py-3 text-[13px] text-muted-foreground">Keine Objektrechte.</p>
        )}
        {(visible.length > MAX_GRANT_ROWS || truncated) && (
          <p className="px-2 py-2 text-xs text-muted-foreground tabular-nums">
            {Math.min(visible.length, MAX_GRANT_ROWS)} von {truncated ? "über " : ""}
            {visible.length}
          </p>
        )}
      </div>
    </div>
  );
}
