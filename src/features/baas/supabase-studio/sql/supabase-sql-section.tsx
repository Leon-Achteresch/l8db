import { EditorView } from "@codemirror/view";
import { useMutation } from "@tanstack/react-query";
import { BookmarkPlusIcon, PlayIcon, PlusIcon, TextCursorInputIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SqlEditor } from "@/features/table/sql-editor";
import {
  type SupabaseSqlResult as SqlResult,
  supabaseStudioSqlRun,
} from "@/lib/db/supabase-studio-sql";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { requestSqlConfirmation } from "@/lib/sql-confirmation";
import { destructiveStatements } from "@/lib/sql-safety";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseSqlLibrary } from "./supabase-sql-library";
import { SupabaseSqlNameDialog } from "./supabase-sql-name-dialog";
import { SupabaseSqlResult } from "./supabase-sql-result";
import {
  addSupabaseSqlTab,
  appendSupabaseSqlHistory,
  closeSupabaseSqlTab,
  emptySupabaseSqlProject,
  useSupabaseSqlStore,
} from "./supabase-sql-store";

interface RunState {
  result: SqlResult | null;
  error: string | null;
}

export function SupabaseSqlSection({ project }: SupabaseStudioSectionProps) {
  const reference = project.reference;
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.sql");
  const stored = useSupabaseSqlStore((state) => state.projects[reference]);
  const update = useSupabaseSqlStore((state) => state.update);
  const [fallback] = useState(emptySupabaseSqlProject);
  const state = stored ?? fallback;
  const tab = state.tabs.find((item) => item.id === state.activeTab) ?? state.tabs[0];
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [savingSnippet, setSavingSnippet] = useState(false);
  const editorHost = useRef<HTMLDivElement>(null);

  const change = (next: Parameters<typeof update>[1]) => update(reference, next, fallback);

  const mutation = useMutation({
    mutationFn: ({ sql, readOnly }: { tabId: string; sql: string; readOnly: boolean }) =>
      supabaseStudioSqlRun(reference, sql, readOnly),
    onSuccess: (result, { tabId, sql }) => {
      setRuns((previous) => ({ ...previous, [tabId]: { result, error: null } }));
      change((current) => ({
        history: appendSupabaseSqlHistory(current.history, {
          sql,
          at: Date.now(),
          ok: true,
          rows: result.row_count,
          durationMs: result.duration_ms,
        }),
      }));
    },
    onError: (error, { tabId, sql }) => {
      setRuns((previous) => ({ ...previous, [tabId]: { result: null, error: String(error) } }));
      change((current) => ({
        history: appendSupabaseSqlHistory(current.history, {
          sql,
          at: Date.now(),
          ok: false,
          rows: null,
          durationMs: null,
        }),
      }));
    },
  });

  const selection = () => {
    const element = editorHost.current?.querySelector<HTMLElement>(".cm-editor");
    const view = element ? EditorView.findFromDOM(element) : null;
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  };

  const run = async (onlySelection: boolean) => {
    if (mutation.isPending) return;
    const selected = selection();
    const sql = onlySelection || selected.trim() ? selected : tab.sql;
    if (!sql.trim()) return;
    if (!state.readOnly) {
      const statements = destructiveStatements(sql, "postgres", { strict: true });
      if (
        statements.length &&
        !(await requestSqlConfirmation({
          connection: project.name,
          database: "Supabase",
          statements,
          title: "Destruktive SQL-Anweisung ausführen?",
          description: "Diese Anweisungen löschen oder verändern Daten oder Strukturen dauerhaft.",
        }))
      )
        return;
    }
    mutation.mutate({ tabId: tab.id, sql, readOnly: state.readOnly });
  };

  const current = runs[tab.id];
  const running = mutation.isPending && mutation.variables?.tabId === tab.id;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 ref={feature.ref} className="flex items-center gap-2 text-lg font-semibold">
          SQL
          {feature.isNew && <NewBadge />}
        </h2>
        <p className="text-sm text-muted-foreground">
          Ergebnisse sind auf 1000 Zeilen begrenzt. Bei mehreren Anweisungen wird das Ergebnis der
          letzten angezeigt.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-1 border-b pb-1" role="tablist">
            {state.tabs.map((item) => (
              <div
                key={item.id}
                className={`flex items-center rounded-md text-sm ${item.id === tab.id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={item.id === tab.id}
                  className="px-2 py-1"
                  onClick={() => change(() => ({ activeTab: item.id }))}
                >
                  {item.title}
                </button>
                <button
                  type="button"
                  aria-label={`${item.title} schließen`}
                  className="mr-1 rounded p-0.5 hover:bg-background"
                  onClick={() => change((current) => closeSupabaseSqlTab(current, item.id))}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Neuer Tab"
              onClick={() => change((current) => addSupabaseSqlTab(current))}
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>
          <div ref={editorHost}>
            <SqlEditor
              key={tab.id}
              value={tab.sql}
              autoFocus
              className="h-56"
              placeholder="select * from auth.users limit 10;"
              onChange={(sql) =>
                change((current) => ({
                  tabs: current.tabs.map((item) => (item.id === tab.id ? { ...item, sql } : item)),
                }))
              }
              onModSubmit={() => void run(false)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={mutation.isPending} onClick={() => void run(false)}>
              <PlayIcon className="size-4" />
              {running ? "Läuft…" : "Ausführen"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void run(true)}
            >
              <TextCursorInputIcon className="size-4" />
              Auswahl ausführen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!tab.sql.trim()}
              onClick={() => setSavingSnippet(true)}
            >
              <BookmarkPlusIcon className="size-4" />
              Als Snippet speichern
            </Button>
            <span className="text-xs text-muted-foreground">Strg/⌘ + Enter</span>
            <div className="ml-auto flex items-center gap-2">
              <Switch
                id={`supabase-sql-read-only-${reference}`}
                checked={state.readOnly}
                onCheckedChange={(readOnly) => change(() => ({ readOnly }))}
              />
              <Label htmlFor={`supabase-sql-read-only-${reference}`} className="text-sm">
                Nur-Lesen
              </Label>
            </div>
          </div>
          <SupabaseSqlResult
            result={current?.result ?? null}
            error={current?.error ?? null}
            running={running}
          />
        </div>
        <SupabaseSqlLibrary
          project={state}
          onOpen={(sql) => change((current) => addSupabaseSqlTab(current, sql))}
          onRenameSnippet={(id, name) =>
            change((current) => ({
              snippets: current.snippets.map((item) => (item.id === id ? { ...item, name } : item)),
            }))
          }
          onDeleteSnippet={(id) =>
            change((current) => ({
              snippets: current.snippets.filter((item) => item.id !== id),
            }))
          }
          onClearHistory={() => change(() => ({ history: [] }))}
        />
      </div>
      {savingSnippet && (
        <SupabaseSqlNameDialog
          title="Als Snippet speichern"
          initial={tab.title}
          onClose={() => setSavingSnippet(false)}
          onSave={(name) => {
            change((current) => ({
              snippets: [...current.snippets, { id: crypto.randomUUID(), name, sql: tab.sql }],
            }));
            setSavingSnippet(false);
          }}
        />
      )}
    </div>
  );
}
