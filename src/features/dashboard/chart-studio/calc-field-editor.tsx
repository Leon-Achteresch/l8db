import { CircleAlertIcon, SigmaIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { queryErrorMessage } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import {
  buildSimpleSql,
  type CalculatedField,
  calcRef,
  createId,
  type SimpleDataset,
  toLabel,
  variableToken,
} from "@/lib/dashboards";
import type { DatabaseKind } from "@/lib/db";
import { useDashboardScope } from "../dashboard-scope";
import { type DatasetColumn, useDebounced, useSqlQuery } from "../use-dataset-query";
import { exprFromDisplay, exprToDisplay, looksAggregate, unknownFields } from "./studio-model";

const PLACEHOLDER = /\[Feld [A-Z]\]/;

function daysSince(kind: DatabaseKind | null): string {
  switch (kind) {
    case "clickhouse":
      return "dateDiff('day', [Feld A], today())";
    case "mysql":
      return "DATEDIFF(CURRENT_DATE, [Feld A])";
    case "mssql":
      return "DATEDIFF(day, [Feld A], GETDATE())";
    case "sqlite":
      return "CAST(julianday('now') - julianday([Feld A]) AS INTEGER)";
    case "oracle":
      return "TRUNC(SYSDATE) - TRUNC([Feld A])";
    default:
      return "(CURRENT_DATE - CAST([Feld A] AS date))";
  }
}

function templates(kind: DatabaseKind | null) {
  return [
    { label: "Verhältnis A ÷ B", text: "[Feld A] / nullif([Feld B], 0)", aggregate: false },
    {
      label: "Summe A ÷ Summe B",
      text: "sum([Feld A]) / nullif(sum([Feld B]), 0)",
      aggregate: true,
    },
    {
      label: "Anteil in %",
      text: "100.0 * sum([Feld A]) / nullif(sum([Feld B]), 0)",
      aggregate: true,
    },
    { label: "Tage seit Datum", text: daysSince(kind), aggregate: false },
    {
      label: "Klassen bilden",
      text: "CASE WHEN [Feld A] < 7 THEN '0–7' WHEN [Feld A] < 30 THEN '8–30' WHEN [Feld A] < 90 THEN '31–90' ELSE '> 90' END",
      aggregate: false,
    },
    { label: "Leere Werte als 0", text: "coalesce([Feld A], 0)", aggregate: false },
  ];
}

export function CalcFieldEditor({
  field,
  simple,
  columns,
  onSave,
  onDelete,
  onDone,
}: {
  field: CalculatedField | null;
  simple: SimpleDataset;
  columns: DatasetColumn[];
  onSave: (field: CalculatedField) => void;
  onDelete?: () => void;
  onDone: () => void;
}) {
  const connection = useActiveConnection();
  const kind = connection?.kind ?? null;
  const scope = useDashboardScope();
  const { variables } = scope;
  const nameId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const plain = columns.filter((c) => !c.ref.startsWith("calc:"));
  const [label, setLabel] = useState(field?.label ?? "");
  const [display, setDisplay] = useState(field ? exprToDisplay(field.expr, plain) : "");
  const [type, setType] = useState<NonNullable<CalculatedField["type"]>>(field?.type ?? "number");
  const [aggregate, setAggregate] = useState<boolean | null>(field ? field.aggregate : null);
  const [fieldSearch, setFieldSearch] = useState("");
  const id = useRef(field?.id ?? createId()).current;
  const expr = exprFromDisplay(display, plain);
  const isAggregate = aggregate ?? looksAggregate(expr);
  const missing = unknownFields(display, plain);
  const draft: CalculatedField = {
    id,
    label: label.trim() || "Neues Feld",
    expr,
    aggregate: isAggregate,
    type,
  };
  const sampleSql =
    expr.trim() && missing.length === 0
      ? buildSimpleSql(
          {
            ...simple,
            calculated: [...(simple.calculated ?? []).filter((c) => c.id !== id), draft],
            dimension: null,
            dimension2: null,
            metrics: [{ id: "v", agg: "none", column: calcRef(id), label: "" }],
            sort: "dimension",
            limit: 6,
          },
          kind,
          "all",
          scope,
        )
      : "";
  const sample = useSqlQuery(useDebounced(sampleSql, 600));

  const insert = (text: string, selectPlaceholder = false) => {
    const el = area.current;
    const start = el?.selectionStart ?? display.length;
    const end = el?.selectionEnd ?? display.length;
    const next = display.slice(0, start) + text + display.slice(end);
    setDisplay(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const placeholder = selectPlaceholder ? PLACEHOLDER.exec(next) : null;
      if (placeholder)
        el.setSelectionRange(placeholder.index, placeholder.index + placeholder[0].length);
      else el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const save = () => {
    onSave(draft);
    onDone();
  };

  const foundFields = plain.filter((c) =>
    c.label.toLowerCase().includes(fieldSearch.toLowerCase()),
  );
  const values = (sample.data?.rows ?? []).map((row) => row.m0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <SigmaIcon className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">
            {field ? "Formel bearbeiten" : "Neues berechnetes Feld"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Rechne mit Feldern, wie in einer Tabellenkalkulation
          </p>
        </div>
      </div>
      <label htmlFor={nameId} className="block space-y-1 text-xs font-medium">
        <span>Name</span>
        <Input
          id={nameId}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="z. B. Reichweite in Tagen"
          className="h-8 text-xs"
        />
      </label>
      <div className="space-y-1.5">
        <p className="flex items-center gap-1 text-xs font-medium">
          <WandSparklesIcon className="size-3.5 text-primary" /> Vorlage einsetzen
        </p>
        <div className="flex flex-wrap gap-1">
          {templates(kind).map((t) => (
            <Button
              key={t.label}
              size="xs"
              variant="outline"
              onClick={() => {
                insert(t.text, true);
                if (aggregate === null && t.aggregate) setAggregate(true);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Formel</p>
        <textarea
          ref={area}
          aria-label="Formel"
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          spellCheck={false}
          rows={3}
          placeholder="[menge] / nullif([artikel.palettenfaktor], 0)"
          className="w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {missing.length > 0 && (
          <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
            <CircleAlertIcon className="size-3" /> Ersetze {missing.map((m) => `[${m}]`).join(", ")}{" "}
            durch ein Feld: markieren, dann unten klicken.
          </p>
        )}
        <div className="rounded-lg border bg-muted/30 p-2">
          <input
            aria-label="Felder für die Formel suchen"
            value={fieldSearch}
            onChange={(e) => setFieldSearch(e.target.value)}
            placeholder="Feld einsetzen…"
            className="mb-1.5 h-7 w-full rounded-md bg-background px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {foundFields.map((c) => (
              <button
                key={c.ref}
                type="button"
                onClick={() => insert(`[${c.label}]`)}
                className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {c.label}
              </button>
            ))}
            {variables.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => insert(variableToken(v.name))}
                className="rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
              >
                Filter: {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium">Ergebnis ist</p>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger size="sm" aria-label="Ergebnistyp" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="number">Zahl</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="date">Datum</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start gap-2 rounded-lg border p-2">
          <Switch
            checked={isAggregate}
            onCheckedChange={(v) => setAggregate(v)}
            aria-label="Fasst Zeilen zusammen"
          />
          <span className="text-[11px] leading-snug">
            <span className="block font-medium">Fasst Zeilen zusammen</span>
            <span className="text-muted-foreground">sum, avg, count … in der Formel</span>
          </span>
        </div>
      </div>
      <div className="space-y-1.5 rounded-lg bg-muted/40 p-2.5" aria-live="polite">
        <p className="text-[11px] font-medium text-muted-foreground">Vorschau mit echten Daten</p>
        {!sampleSql ? (
          <p className="text-[11px] text-muted-foreground">Gib eine Formel ein.</p>
        ) : sample.isError ? (
          <p role="alert" className="text-[11px] text-destructive">
            {queryErrorMessage(sample.error)}
          </p>
        ) : sample.isFetching && values.length === 0 ? (
          <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        ) : (
          <div className="flex flex-wrap gap-1">
            {values.map((value, index) => (
              <span
                key={`${index}:${String(value)}`}
                className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
              >
                {value === null || value === undefined ? "leer" : toLabel(value)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t pt-3">
        {onDelete && (
          <Button variant="ghost" size="xs" className="text-destructive" onClick={onDelete}>
            <Trash2Icon /> Löschen
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Abbrechen
          </Button>
          <Button size="sm" disabled={!expr.trim() || missing.length > 0} onClick={save}>
            {field ? "Übernehmen" : "Feld anlegen"}
          </Button>
        </div>
      </div>
    </div>
  );
}
