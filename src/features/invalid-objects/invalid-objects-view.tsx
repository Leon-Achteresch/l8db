import { useNavigate } from "@tanstack/react-router";
import { Hammer, Loader } from "lucide";
import { CircleCheckIcon, CircleXIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import {
  buildInvalidProblems,
  compileArgForInvalidType,
  filterInvalidProblems,
  INVALID_RENDER_STEP,
  invalidTypeLabels,
} from "@/lib/invalid-objects";
import {
  useCompileErrorsQuery,
  useCompileInvalidObjectsMutation,
  useInvalidObjectsQuery,
} from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { InvalidOtherMessages } from "./invalid-other-messages";
import { InvalidProblemGroup } from "./invalid-problem-group";

export function InvalidObjectsView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const caps = useActiveCapabilities();
  const invalidQuery = useInvalidObjectsQuery();
  const errorsQuery = useCompileErrorsQuery();
  const compileAll = useCompileInvalidObjectsMutation();
  const { compile } = useCompileObject();
  const navigate = useNavigate();
  const openFunctionTab = useTableTabs((s) => s.openFunctionTab);
  const openProcedureTab = useTableTabs((s) => s.openProcedureTab);
  const openPackageTab = useTableTabs((s) => s.openPackageTab);
  const openViewEditorTab = useTableTabs((s) => s.openViewEditorTab);
  const [compilingOid, setCompilingOid] = useState<string | null>(null);
  const invalid = useMemo(() => invalidQuery.data ?? [], [invalidQuery.data]);
  const errors = useMemo(() => errorsQuery.data ?? [], [errorsQuery.data]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [limit, setLimit] = useState(INVALID_RENDER_STEP);
  const [othersOpen, setOthersOpen] = useState(false);
  const scope = `${connection?.id ?? ""}\u001f${database ?? ""}\u001f${schema ?? ""}`;
  const [scopeSeen, setScopeSeen] = useState(scope);
  if (scopeSeen !== scope) {
    setScopeSeen(scope);
    setQuery("");
    setTypeFilter(null);
    setCollapsed(new Set());
    setLimit(INVALID_RENDER_STEP);
    setOthersOpen(false);
  }
  const { problems, others } = useMemo(
    () => buildInvalidProblems(invalid, errors),
    [invalid, errors],
  );
  const messages = errorsQuery.isError ? "error" : errorsQuery.isLoading ? "loading" : "ready";
  const types = useMemo(() => invalidTypeLabels(invalid), [invalid]);
  const activeType = typeFilter && types.includes(typeFilter) ? typeFilter : null;
  const visible = useMemo(
    () => filterInvalidProblems(problems, activeType, query),
    [problems, activeType, query],
  );
  const showOthers = others.length > 0 && !activeType && query.trim() === "";
  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }
  if (!caps.compile_objects) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Invalide Objekte werden für diese Verbindung nicht unterstützt.
        </p>
      </div>
    );
  }
  const handleRefresh = () => {
    void invalidQuery.refetch();
    void errorsQuery.refetch();
  };
  const handleCompileAll = async () => {
    try {
      const results = await compileAll.mutateAsync();
      const ok = results.filter((r) => r.status === "VALID").length;
      const bad = results.length - ok;
      if (results.length === 0) {
        toast.success("Keine invaliden Objekte gefunden");
      } else if (bad === 0) {
        toast.success(`${ok} ${ok === 1 ? "Objekt" : "Objekte"} kompiliert`, {
          description: "Alle Objekte sind jetzt VALID",
        });
      } else {
        toast.error(`${bad} ${bad === 1 ? "Objekt" : "Objekte"} weiterhin INVALID`, {
          description: `${ok} kompiliert`,
        });
      }
    } catch (e) {
      toast.error("Kompilieren fehlgeschlagen", { description: String(e) });
    }
  };
  const handleCompileOne = async (oid: string, objectType: string, label: string) => {
    setCompilingOid(oid);
    try {
      await compile(oid, objectType as "function", label);
      void invalidQuery.refetch();
      void errorsQuery.refetch();
    } finally {
      setCompilingOid(null);
    }
  };
  const handleOpen = (schema: string, name: string, objectType: string, oid: string) => {
    const t = objectType.toUpperCase();
    if (t === "FUNCTION" || t === "TRIGGER" || t === "TYPE" || t === "TYPE BODY") {
      openFunctionTab({ schema, name, oid });
      void navigate({ to: "/functions/$schema/$name", params: { schema, name }, search: { oid } });
    } else if (t === "PROCEDURE") {
      openProcedureTab({ schema, name, oid });
      void navigate({ to: "/procedures/$schema/$name", params: { schema, name }, search: { oid } });
    } else if (t === "PACKAGE" || t === "PACKAGE BODY") {
      openPackageTab({ schema, name });
      void navigate({ to: "/packages/$schema/$name", params: { schema, name }, search: {} });
    } else if (t === "VIEW") {
      openViewEditorTab({ schema, view: name });
      void navigate({ to: "/view-editor/$schema/$view", params: { schema, view: name } });
    } else {
      toast.info(`${schema}.${name} (${objectType}) kann hier nicht geöffnet werden`);
    }
  };
  const toggle = (oid: string) => {
    const next = new Set(collapsed);
    if (next.has(oid)) next.delete(oid);
    else next.add(oid);
    setCollapsed(next);
  };
  const selectType = (type: string | null) => {
    setTypeFilter(type);
    setLimit(INVALID_RENDER_STEP);
  };
  const shown = visible.slice(0, limit);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <div className="flex h-7 w-56 shrink-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 focus-within:ring-2 focus-within:ring-ring/50">
          <SearchIcon className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(INVALID_RENDER_STEP);
            }}
            placeholder="Objekte filtern"
            aria-label="Invalide Objekte filtern"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          <button
            type="button"
            aria-pressed={!activeType}
            onClick={() => selectType(null)}
            className={cn(
              "h-7 shrink-0 cursor-pointer rounded-md px-2 text-xs text-muted-foreground hover:bg-muted",
              !activeType && "bg-muted text-foreground",
            )}
          >
            Alle <span className="tabular-nums">{invalid.length}</span>
          </button>
          {types.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={activeType === type}
              onClick={() => selectType(activeType === type ? null : type)}
              className={cn(
                "h-7 shrink-0 cursor-pointer rounded-md px-2 text-xs text-muted-foreground hover:bg-muted",
                activeType === type && "bg-muted text-foreground",
              )}
            >
              {type}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleRefresh}
          title="Neu laden"
          aria-label="Neu laden"
        >
          <RefreshCwIcon />
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() => void handleCompileAll()}
          disabled={compileAll.isPending || compilingOid !== null || invalid.length === 0}
          title="Alle invaliden Objekte kompilieren"
        >
          <MorphIcon
            icon={compileAll.isPending ? Loader : Hammer}
            data-icon="inline-start"
            className={cn(compileAll.isPending && "animate-spin")}
          />
          Alle kompilieren
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {invalidQuery.isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Spinner />
            Lade invalide Objekte…
          </div>
        ) : invalidQuery.isError ? (
          <p className="p-4 text-sm text-destructive">{String(invalidQuery.error)}</p>
        ) : invalid.length === 0 && others.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-emerald-500" />
            Keine Probleme. Alle Objekte sind VALID.
          </p>
        ) : visible.length === 0 && !showOthers ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Keine Treffer für diesen Filter.
          </p>
        ) : (
          <ul className="py-1 font-mono text-xs">
            {shown.map((problem) => (
              <InvalidProblemGroup
                key={problem.item.oid}
                problem={problem}
                open={!collapsed.has(problem.item.oid)}
                compiling={compilingOid === problem.item.oid}
                blocked={compileAll.isPending}
                messages={messages}
                onToggle={() => toggle(problem.item.oid)}
                onOpen={() =>
                  handleOpen(
                    problem.item.schema,
                    problem.item.name,
                    problem.item.object_type,
                    problem.item.oid,
                  )
                }
                onCompile={() =>
                  void handleCompileOne(
                    problem.item.oid,
                    compileArgForInvalidType(problem.item.object_type),
                    `${problem.item.schema}.${problem.item.name}`,
                  )
                }
              />
            ))}
            {visible.length > shown.length && (
              <li className="px-3 py-2 font-sans">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setLimit(limit + INVALID_RENDER_STEP)}
                >
                  Weitere {Math.min(INVALID_RENDER_STEP, visible.length - shown.length)} von{" "}
                  {visible.length - shown.length} anzeigen
                </Button>
              </li>
            )}
            {showOthers && (
              <InvalidOtherMessages
                messages={others}
                open={othersOpen}
                onToggle={() => setOthersOpen(!othersOpen)}
              />
            )}
          </ul>
        )}
      </div>
      <div className="flex h-6 shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CircleXIcon className="size-3 text-destructive" />
          <span className="tabular-nums">{messages === "ready" ? errors.length : "–"}</span>
          {errors.length === 1 ? "Meldung" : "Meldungen"}
        </span>
        <span className="tabular-nums">
          {invalid.length} {invalid.length === 1 ? "Objekt" : "Objekte"}
        </span>
        {errorsQuery.isError && <span className="text-destructive">Meldungen nicht geladen</span>}
        <span className="flex-1" />
        <span>Quelle: ALL_ERRORS</span>
      </div>
    </div>
  );
}
