import { useNavigate } from "@tanstack/react-router";
import { EraserIcon, HammerIcon, LoaderIcon, RefreshCwIcon, TerminalIcon, XCircleIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { compileArgForInvalidType } from "@/lib/invalid-objects";
import {
  useCompileErrorsQuery,
  useCompileInvalidObjectsMutation,
  useInvalidObjectsQuery,
} from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

export function InvalidObjectsView() {
  const connection = useActiveConnection();
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
        <p className="text-sm text-muted-foreground">Invalide Objekte werden für diese Verbindung nicht unterstützt.</p>
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
        toast.success(`${ok} Objekte kompiliert`, { description: "Alle Objekte sind jetzt VALID" });
      } else {
        toast.error(`${bad} Objekte weiterhin INVALID`, { description: `${ok} kompiliert` });
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
    if (t === "FUNCTION") {
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
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <XCircleIcon className="size-4 text-destructive" />
        <span className="text-sm font-semibold">Invalid Objects</span>
        <Badge variant={invalid.length > 0 ? "destructive" : "outline"} className="tabular-nums">
          {invalid.length}
        </Badge>
        <span className="text-xs text-muted-foreground">Outputs: {errors.length}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={handleRefresh} title="Neu laden">
          <RefreshCwIcon data-icon="inline-start" />
          Neu laden
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() => void handleCompileAll()}
          disabled={compileAll.isPending || invalid.length === 0}
          title="Alle invaliden Objekte kompilieren"
        >
          {compileAll.isPending ? (
            <LoaderIcon data-icon="inline-start" className="animate-spin" />
          ) : (
            <HammerIcon data-icon="inline-start" />
          )}
          Compile invalid objects
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col border-r">
          <div className="shrink-0 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
            Invalide Objekte ({invalid.length})
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {invalidQuery.isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Spinner />
                Lade invalide Objekte…
              </div>
            ) : invalidQuery.isError ? (
              <p className="p-4 text-sm text-destructive">{String(invalidQuery.error)}</p>
            ) : invalid.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Alle Objekte sind VALID.</p>
            ) : (
              <ul className="divide-y">
                {invalid.map((item) => (
                  <li key={item.oid} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <XCircleIcon className="size-4 shrink-0 text-destructive" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">
                        {item.schema}.{item.name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{item.object_type}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleOpen(item.schema, item.name, item.object_type, item.oid)}
                      title="Öffnen"
                    >
                      Öffnen
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={compilingOid === item.oid || item.object_type.toUpperCase() === "SYNONYM"}
                      onClick={() =>
                        void handleCompileOne(
                          item.oid,
                          compileArgForInvalidType(item.object_type),
                          `${item.schema}.${item.name}`,
                        )
                      }
                      title={
                        item.object_type.toUpperCase() === "SYNONYM"
                          ? "Synonyme können nicht kompiliert werden"
                          : "Einzeln kompilieren"
                      }
                    >
                      {compilingOid === item.oid ? (
                        <LoaderIcon data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <HammerIcon data-icon="inline-start" />
                      )}
                      Kompilieren
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
            <TerminalIcon className="size-3.5" />
            Outputs (ALL_ERRORS) ({errors.length})
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {errorsQuery.isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Spinner />
                Lade Outputs…
              </div>
            ) : errorsQuery.isError ? (
              <p className="p-4 text-sm text-destructive">{String(errorsQuery.error)}</p>
            ) : errors.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center">
                <EraserIcon className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Keine Outputs vorhanden.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {errors.map((err, idx) => (
                  <li key={`${err.schema}.${err.name}.${err.object_type}.${idx}`} className="px-4 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="destructive" className="shrink-0 text-[10px]">
                        {err.object_type}
                      </Badge>
                      <span className="truncate font-mono">
                        {err.schema}.{err.name}
                      </span>
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                        {err.line != null ? `Zeile ${err.line}` : ""}
                        {err.position != null ? `, Pos ${err.position}` : ""}
                      </span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-destructive select-text">
                      {err.message}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
