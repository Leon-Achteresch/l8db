import { PlusIcon, XIcon } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { operatorNeedsList, parseFilterList } from "@/lib/sql-filter";
import { looksLikeSqlFilterList } from "@/lib/sql-filter-list-import";
import { cn } from "@/lib/utils";
import { DateFilterInput } from "./date-filter-input";
import { SqlFilterListImport } from "./sql-filter-list-import";

function splitPasted(text: string): string[] {
  return text
    .split(/[\r\n\t,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

type FilterValueInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  operator: string;
  value: string;
  onValueChange: (value: string) => void;
  date?: boolean;
};

export function FilterValueInput({
  operator,
  value,
  onValueChange,
  date,
  className,
  ...props
}: FilterValueInputProps) {
  const [draft, setDraft] = useState("");
  const [sqlImport, setSqlImport] = useState<{
    operator: string;
    value: string;
    source: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sqlImport && (sqlImport.operator !== operator || sqlImport.value !== value))
      setSqlImport(null);
  }, [sqlImport, operator, value]);
  if (date && !operatorNeedsList(operator)) {
    return (
      <DateFilterInput
        {...props}
        value={value}
        onValueChange={onValueChange}
        className={className}
      />
    );
  }
  if (!operatorNeedsList(operator)) {
    return (
      <Input
        {...props}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={className}
      />
    );
  }

  const values = [...new Set(parseFilterList(value))];
  const source =
    sqlImport?.operator === operator && sqlImport.value === value ? sqlImport.source : null;
  const setSource = (source: string | null) =>
    setSqlImport(source === null ? null : { operator, value, source });
  const addValue = () => {
    if (!draft.trim()) return;
    if (looksLikeSqlFilterList(draft)) {
      setSource(draft);
      return;
    }
    onValueChange(JSON.stringify([...new Set([...values, draft])]));
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <div
      className={cn(
        "flex w-full min-w-0 rounded-xl border border-input bg-background/80 focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/40",
        className,
        "h-auto min-h-8",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 p-1">
        {values.map((item) => (
          <span
            key={item}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
          >
            <span className="min-w-0 whitespace-pre-wrap break-all">{item}</span>
            <button
              type="button"
              aria-label={`Wert entfernen: ${item}`}
              disabled={props.disabled}
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                onValueChange(JSON.stringify(values.filter((entry) => entry !== item)));
                inputRef.current?.focus();
              }}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          {...props}
          ref={inputRef}
          aria-label={props["aria-label"] ?? "Listenwert"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            if (props.disabled) return;
            const text = event.clipboardData.getData("text");
            if (looksLikeSqlFilterList(text)) {
              event.preventDefault();
              setSource(text);
              return;
            }
            const parts = splitPasted(text);
            if (parts.length < 2) return;
            event.preventDefault();
            onValueChange(JSON.stringify([...new Set([...values, ...parts])]));
            setDraft("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              addValue();
            }
          }}
          placeholder="Wert + Enter"
          className="h-6 min-w-16 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>
      <SqlFilterListImport
        source={source}
        onSourceChange={setSource}
        initialSource={draft}
        value={value}
        inputRef={inputRef}
        disabled={props.disabled}
        onImport={(next) => {
          onValueChange(next);
          setDraft("");
          setSource(null);
        }}
      />
      <button
        type="button"
        aria-label="Wert hinzufügen"
        title="Wert hinzufügen (Enter)"
        disabled={props.disabled || !draft.trim()}
        onClick={addValue}
        className="m-1 flex size-6 shrink-0 items-center justify-center self-end rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
