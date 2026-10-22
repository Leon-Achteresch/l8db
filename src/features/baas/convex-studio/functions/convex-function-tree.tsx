import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { ConvexStudioModule, ConvexUdfType } from "@/lib/db/convex-studio-functions";

const TYPE_LABEL: Record<ConvexUdfType, string> = {
  query: "Q",
  mutation: "M",
  action: "A",
  httpAction: "H",
  unknown: "?",
};

const TYPE_TITLE: Record<ConvexUdfType, string> = {
  query: "Query",
  mutation: "Mutation",
  action: "Aktion",
  httpAction: "HTTP-Aktion",
  unknown: "Unbekannt",
};

export function ConvexFunctionTree({
  modules,
  loading,
  selected,
  onSelect,
}: {
  modules: ConvexStudioModule[];
  loading: boolean;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const visible = modules
    .map((module) => ({
      module,
      functions: module.functions.filter(
        (fn) =>
          !needle ||
          fn.identifier.toLowerCase().includes(needle) ||
          module.path.toLowerCase().includes(needle),
      ),
    }))
    .filter((entry) => entry.functions.length > 0);
  const total = modules.reduce((sum, module) => sum + module.functions.length, 0);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground" />
        <Input
          className="h-8 pl-7 text-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`${total} Funktionen durchsuchen`}
          aria-label="Funktionen durchsuchen"
        />
      </div>
      {loading && <p className="text-xs text-muted-foreground">Funktionen werden geladen…</p>}
      {!loading && visible.length === 0 && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {total === 0 ? "Dieses Deployment hat noch keine Funktionen." : "Keine Treffer."}
        </p>
      )}
      <ul className="max-h-[70vh] space-y-1 overflow-auto">
        {visible.map(({ module, functions }) => (
          <li key={`${module.componentPath}|${module.path}`}>
            <details open={Boolean(needle) || functions.length <= 12} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-1 font-mono text-xs text-muted-foreground hover:bg-muted">
                <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                <span className="truncate" title={module.path}>
                  {module.componentPath ? `${module.componentPath}/` : ""}
                  {module.path}
                </span>
              </summary>
              <ul className="ml-3 border-l pl-1">
                {functions.map((fn) => {
                  const key = `${module.componentPath}|${fn.identifier}`;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        aria-current={selected === key ? "true" : undefined}
                        onClick={() => onSelect(key)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors ${selected === key ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                      >
                        <span
                          title={TYPE_TITLE[fn.udfType]}
                          className="flex size-4 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] text-muted-foreground"
                        >
                          {TYPE_LABEL[fn.udfType]}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{fn.name}</span>
                        {fn.visibility === "internal" && (
                          <Badge variant="outline" className="text-[10px]">
                            intern
                          </Badge>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
