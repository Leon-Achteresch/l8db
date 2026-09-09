import { useNavigate } from "@tanstack/react-router";
import { BracesIcon, ColumnsIcon, EyeIcon, SearchIcon, TableIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { RegexSearchHelper } from "@/components/regex-search-helper";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";
import { useColumnSearchQuery, useSchemasQuery, useSourceSearchQuery } from "@/lib/queries";
import {
  compileRegexSearch,
  describeRegexError,
  insertRegexPattern,
  regexLiteralPrefilter,
} from "@/lib/regex-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";

const ALL_SCHEMAS = "__all__";

interface ObjectSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ObjectSearchDialog({ open, onOpenChange }: ObjectSearchDialogProps) {
  const navigate = useNavigate();
  const connection = useActiveConnection();
  const canSearchColumns = supports(connection, "column_search");
  const canSearchSource = supports(connection, "source_search");
  const [tab, setTab] = useState<"columns" | "source">(canSearchColumns ? "columns" : "source");
  const [term, setTerm] = useState("");
  const [schema, setSchema] = useState<string>(ALL_SCHEMAS);
  const schemaFilter = schema === ALL_SCHEMAS ? undefined : schema;
  const { data: schemas } = useSchemasQuery();

  const sourceRegex = useRegexEnabled("source");
  const setRegexEnabled = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const regexActive = tab === "source" && sourceRegex;

  const compiled = useMemo(
    () => (regexActive && term.trim() ? compileRegexSearch(term.trim()) : null),
    [regexActive, term],
  );
  const regexError = compiled && !compiled.ok ? compiled.error : null;
  const prefilter = useMemo(
    () => (regexActive ? regexLiteralPrefilter(term.trim()) : term),
    [regexActive, term],
  );
  const sourceTerm = regexActive ? (regexError ? "" : prefilter) : term;

  const columnSearch = useColumnSearchQuery(tab === "columns" ? term : "", schemaFilter);
  const sourceSearch = useSourceSearchQuery(tab === "source" ? sourceTerm : "", schemaFilter);
  const active = tab === "columns" ? columnSearch : sourceSearch;
  const sourceMatches = useMemo(() => {
    const rows = sourceSearch.data ?? [];
    if (!regexActive || !compiled?.ok) return rows;
    return rows.filter((match) => compiled.regex.test(match.snippet));
  }, [sourceSearch.data, regexActive, compiled]);
  const tooShort =
    tab === "source"
      ? sourceTerm.trim().length > 0 && sourceTerm.trim().length < 2
      : term.trim().length > 0 && term.trim().length < 2;
  const prefilterMissing =
    regexActive && !regexError && term.trim().length > 0 && prefilter.trim().length < 2;

  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Objektsuche</DialogTitle>
          <DialogDescription>
            Spaltennamen und Quelltext von Routinen und Views der aktiven Datenbank durchsuchen.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(value as "columns" | "source")}>
          <TabsList className="w-full">
            <TabsTrigger value="columns" className="flex-1" disabled={!canSearchColumns}>
              <ColumnsIcon className="size-4" />
              Spalten
            </TabsTrigger>
            <TabsTrigger value="source" className="flex-1" disabled={!canSearchSource}>
              <BracesIcon className="size-4" />
              Quelltext
            </TabsTrigger>
          </TabsList>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="object-search-term"
                autoFocus
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={
                  tab === "columns"
                    ? "Spaltenname…"
                    : sourceRegex
                      ? "Regulärer Ausdruck im Quelltext…"
                      : "Text im Quelltext…"
                }
                className="pl-8"
              />
            </div>
            {tab === "source" ? (
              <RegexSearchHelper
                enabled={sourceRegex}
                onEnabledChange={(enabled) => setRegexEnabled("source", enabled)}
                query={term}
                onQueryChange={setTerm}
                onInsert={(snippet) => {
                  const input = document.getElementById(
                    "object-search-term",
                  ) as HTMLInputElement | null;
                  const start = input?.selectionStart ?? term.length;
                  const end = input?.selectionEnd ?? term.length;
                  const next = insertRegexPattern(term, start, end, snippet);
                  setTerm(next.value);
                  requestAnimationFrame(() => {
                    input?.focus();
                    input?.setSelectionRange(next.cursor, next.cursor);
                  });
                }}
                error={regexError}
                matchCount={sourceMatches.length}
              />
            ) : null}
            <Select value={schema} onValueChange={setSchema}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Alle Schemas" />
              </SelectTrigger>
              <SelectContent searchable>
                <SelectItem value={ALL_SCHEMAS}>Alle Schemas</SelectItem>
                {(schemas ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tooShort ? (
            <p className="mt-2 text-sm text-muted-foreground">Mindestens zwei Zeichen eingeben.</p>
          ) : null}
          {regexError ? (
            <p className="mt-2 text-sm text-destructive">{describeRegexError(regexError)}</p>
          ) : null}
          {prefilterMissing ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Für die Serversuche werden mindestens zwei zusammenhängende literale Zeichen im Muster
              benötigt.
            </p>
          ) : null}
          {regexActive && !regexError && !prefilterMissing && term.trim() ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Der Server sucht vorab nach „{prefilter}“; der reguläre Ausdruck filtert die
              gefundenen Textausschnitte nach.
            </p>
          ) : null}
          {active.isError ? (
            <p className="mt-2 text-sm text-destructive">
              Suche fehlgeschlagen:{" "}
              {(active.error as Error | null)?.message ?? "Unbekannter Fehler"}
            </p>
          ) : null}
          {active.isFetching ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Suche läuft…
            </p>
          ) : null}
          <TabsContent value="columns">
            <ScrollArea className="mt-2 h-80">
              {!active.isError && columnSearch.data?.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">Keine Treffer.</p>
              ) : null}
              <ul className="flex flex-col gap-1">
                {(columnSearch.data ?? []).map((match) => (
                  <li key={`${match.schema}.${match.table}.${match.column}`}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        close();
                        void navigate({
                          to: "/tables/$schema/$table",
                          params: { schema: match.schema, table: match.table },
                          search: {
                            type: match.object_type === "VIEW" ? "view" : undefined,
                            column: match.column,
                          },
                        });
                      }}
                    >
                      {match.object_type === "VIEW" ? (
                        <EyeIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <TableIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-medium">{match.column}</span>
                      <span className="truncate text-muted-foreground">
                        {match.schema}.{match.table}
                      </span>
                      <Badge variant="outline" className="ml-auto shrink-0">
                        {match.data_type}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="source">
            <ScrollArea className="mt-2 h-80">
              {!active.isError && sourceSearch.data && sourceMatches.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">Keine Treffer.</p>
              ) : null}
              <ul className="flex flex-col gap-1">
                {sourceMatches.map((match) => (
                  <li key={`${match.object_type}:${match.oid}`}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        close();
                        if (match.object_type === "procedure") {
                          void navigate({
                            to: "/procedures/$schema/$name",
                            params: { schema: match.schema, name: match.name },
                            search: { oid: match.oid, line: match.line },
                          });
                          return;
                        }
                        if (match.object_type === "routine") {
                          void navigate({
                            to: "/functions/$schema/$name",
                            params: { schema: match.schema, name: match.name },
                            search: { oid: match.oid, line: match.line },
                          });
                          return;
                        }
                        void navigate({
                          to: "/view-editor/$schema/$view",
                          params: { schema: match.schema, view: match.name },
                        });
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {match.object_type === "routine" || match.object_type === "procedure" ? (
                          <BracesIcon className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <EyeIcon className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate font-medium">
                          {match.schema}.{match.name}
                          {match.identity ? `(${match.identity})` : ""}
                        </span>
                        <Badge variant="outline" className="ml-auto shrink-0">
                          Zeile {match.line} · {match.occurrences}×
                        </Badge>
                      </span>
                      <code className="truncate rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
                        {match.snippet}
                      </code>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
