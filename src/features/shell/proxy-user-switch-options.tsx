import { CornerDownLeft, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { connectionError } from "@/lib/connection-url";
import type { DatabaseKind, ProxyUserInfo } from "@/lib/db";
import { cn } from "@/lib/utils";

const GROUP_LABELS: Record<string, Record<ProxyUserInfo["category"], string>> = {
  postgres: { login: "Logins", user: "Benutzer", role: "Rollen" },
  mssql: { login: "Logins", user: "Datenbank-Benutzer", role: "Rollen" },
  oracle: { login: "Logins", user: "Freigegebene Benutzer", role: "Rollen" },
  snowflake: { login: "Logins", user: "Benutzer", role: "Rollen" },
};

const CATEGORIES: ProxyUserInfo["category"][] = ["login", "user", "role"];
const MAX_VISIBLE_USERS = 100;

interface ProxyUserSwitchOptionsProps {
  kind: DatabaseKind;
  active: string | null;
  search: string;
  onSearch: (value: string) => void;
  busy: boolean;
  users: ProxyUserInfo[];
  loading: boolean;
  error: unknown;
  onApply: (proxyUser: string | null) => void;
}

export function ProxyUserSwitchOptions({
  kind,
  active,
  search,
  onSearch,
  busy,
  users,
  loading,
  error,
  onApply,
}: ProxyUserSwitchOptionsProps) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const typed = search.trim();
  const roleSwitch = kind === "snowflake";
  const labels = GROUP_LABELS[kind] ?? GROUP_LABELS.postgres;
  const { options, hidden } = useMemo(() => {
    const term = typed.toLowerCase();
    const next: Array<{
      key: string;
      group: string;
      name: string;
      value: string | null;
      bypassesRls: boolean;
    }> = [];
    let shownUsers = 0;
    let hidden = 0;
    if (active && (!term || "beenden".includes(term)))
      next.push({
        key: "reset",
        group: "",
        name: roleSwitch ? `Rolle ${active} verlassen` : `Als ${active} beenden`,
        value: null,
        bypassesRls: false,
      });
    for (const category of CATEGORIES)
      for (const user of users)
        if (user.category === category && user.name.toLowerCase().includes(term)) {
          if (shownUsers === MAX_VISIBLE_USERS) {
            hidden++;
            continue;
          }
          shownUsers++;
          next.push({
            key: `${category}:${user.name}`,
            group: labels[category],
            name: user.name,
            value: user.name,
            bypassesRls: user.bypasses_rls,
          });
        }
    if (typed && !users.some((user) => user.name === typed))
      next.push({
        key: "custom",
        group: "Eigene Eingabe",
        name: `„${typed}“ übernehmen`,
        value: typed,
        bypassesRls: false,
      });
    return { options: next, hidden };
  }, [active, labels, roleSwitch, typed, users]);
  const activeIndex = Math.min(selected, Math.max(0, options.length - 1));

  function move(direction: number) {
    if (!options.length) return;
    const next = (activeIndex + direction + options.length) % options.length;
    setSelected(next);
    listRef.current?.querySelector<HTMLElement>(`[data-option-index="${next}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }

  return (
    <div>
      <div className="border-b px-3 py-2">
        <input
          role="combobox"
          aria-label="Proxy-Benutzer suchen"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={options.length ? `${id}-option-${activeIndex}` : undefined}
          className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          placeholder="Benutzer oder Rolle suchen…"
          value={search}
          disabled={busy}
          onChange={(event) => {
            setSelected(0);
            onSearch(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter" && options.length && !busy) {
              event.preventDefault();
              onApply(options[activeIndex].value);
            }
          }}
        />
      </div>
      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label="Proxy-Benutzer"
        className="max-h-72 overflow-auto p-1"
      >
        {options.map((option, index) => (
          <div key={option.key}>
            {option.group && option.group !== options[index - 1]?.group && (
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {option.group}
              </p>
            )}
            <button
              id={`${id}-option-${index}`}
              data-option-index={index}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              data-checked={option.value === active}
              disabled={busy}
              onPointerMove={() => setSelected(index)}
              onClick={() => onApply(option.value)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-50",
                activeIndex === index && "bg-accent text-accent-foreground",
              )}
            >
              {option.value === null && <X className="size-4" />}
              {option.key === "custom" && <CornerDownLeft className="size-4" />}
              <span className="truncate">{option.name}</span>
              {option.bypassesRls && (
                <span className="ml-auto shrink-0 rounded bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                  umgeht RLS
                </span>
              )}
            </button>
          </div>
        ))}
        {hidden > 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            … und {hidden} weitere. Suche eingrenzen.
          </p>
        )}
        {loading && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Lade Benutzer…</p>
        )}
        {error != null && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Liste nicht verfügbar: {connectionError(error)}
          </p>
        )}
        {!loading && error == null && !options.length && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Keine Treffer.</p>
        )}
      </div>
    </div>
  );
}
