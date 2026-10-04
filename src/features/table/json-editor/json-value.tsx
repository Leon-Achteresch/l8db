import {
  CalendarIcon,
  ExternalLinkIcon,
  FingerprintIcon,
  MailIcon,
  PackageOpenIcon,
} from "lucide-react";
import { useMemo } from "react";
import { type JsonRow, previewValue, stringHint } from "@/lib/json-editor";
import { cn } from "@/lib/utils";
import { JsonHighlight } from "./json-highlight";

const MAX_STRING = 400;

type Props = {
  row: JsonRow;
  query: string;
  readOnly: boolean;
  onToggleBoolean: () => void;
  onOpenUrl: (url: string) => void;
  onUnpack: () => void;
};

export function JsonValue({ row, query, readOnly, onToggleBoolean, onOpenUrl, onUnpack }: Props) {
  const text = row.kind === "string" ? (row.value as string) : null;
  const hint = useMemo(() => (text === null ? null : stringHint(text)), [text]);

  if (row.kind === "object" || row.kind === "array") {
    const open = row.kind === "array" ? "[" : "{";
    const close = row.kind === "array" ? "]" : "}";
    if (row.expanded) return <span className="text-muted-foreground">{open}</span>;
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground">
          {open}
          {row.childCount > 0 && "…"}
          {close}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
          {row.childCount}{" "}
          {row.kind === "object" ? "Schlüssel" : row.childCount === 1 ? "Element" : "Elemente"}
        </span>
        {row.childCount > 0 && (
          <span className="truncate text-muted-foreground/70">{previewValue(row.value)}</span>
        )}
      </span>
    );
  }

  if (row.kind === "boolean")
    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={(event) => {
          event.stopPropagation();
          onToggleBoolean();
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md font-medium text-amber-600 dark:text-amber-300",
          !readOnly && "hover:bg-amber-500/10 px-1 -mx-1",
        )}
        title={readOnly ? undefined : "Klicken zum Umschalten"}
      >
        <span
          className={cn(
            "relative inline-flex h-3 w-5 rounded-full transition-colors",
            row.value ? "bg-amber-500" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-2 rounded-full bg-white shadow-sm transition-transform",
              row.value ? "translate-x-2.5" : "translate-x-0.5",
            )}
          />
        </span>
        <JsonHighlight text={String(row.value)} query={query} />
      </button>
    );

  if (row.kind === "null")
    return (
      <span className="italic text-muted-foreground">
        <JsonHighlight text="null" query={query} />
      </span>
    );

  if (row.kind === "number")
    return (
      <span className="font-medium text-blue-600 tabular-nums dark:text-blue-300">
        <JsonHighlight text={String(row.value)} query={query} />
      </span>
    );

  const shown =
    (text ?? "").length > MAX_STRING ? `${(text ?? "").slice(0, MAX_STRING)}…` : (text ?? "");
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {hint === "color" && (
        <span
          className="size-3 shrink-0 rounded-sm ring-1 ring-black/10 dark:ring-white/15"
          style={{ backgroundColor: text ?? undefined }}
        />
      )}
      <span
        className="truncate text-emerald-700 dark:text-emerald-300"
        title={(text ?? "").length > 60 ? (text ?? "") : undefined}
      >
        <span className="text-emerald-700/50 dark:text-emerald-300/50">"</span>
        <JsonHighlight text={shown} query={query} />
        <span className="text-emerald-700/50 dark:text-emerald-300/50">"</span>
      </span>
      {hint === "url" && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenUrl(text ?? "");
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Link öffnen"
        >
          <ExternalLinkIcon className="size-3" />
        </button>
      )}
      {hint === "email" && <MailIcon className="size-3 shrink-0 text-muted-foreground" />}
      {hint === "uuid" && <FingerprintIcon className="size-3 shrink-0 text-muted-foreground" />}
      {hint === "date" && (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground"
          title={new Date(text ?? "").toString()}
        >
          <CalendarIcon className="size-2.5" />
          {new Date(text ?? "").toLocaleString()}
        </span>
      )}
      {hint === "json" && (
        <button
          type="button"
          disabled={readOnly}
          onClick={(event) => {
            event.stopPropagation();
            onUnpack();
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/12 px-1.5 text-[10px] font-medium text-violet-600 enabled:hover:bg-violet-500/20 dark:text-violet-300"
          title={readOnly ? "Enthält eingebettetes JSON" : "Eingebettetes JSON entpacken"}
        >
          <PackageOpenIcon className="size-2.5" />
          JSON
        </button>
      )}
    </span>
  );
}
