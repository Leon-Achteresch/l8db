import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TemplateInput } from "./template-input";

interface Props {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  keyLabel: string;
  valueLabel: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel: string;
}

type Row = { id: number; key: string; value: string };

function toRows(value: Record<string, string>, start = 0): Row[] {
  return Object.entries(value).map(([key, entry], index) => ({
    id: start + index,
    key,
    value: entry,
  }));
}

function toRecord(rows: Row[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]),
  );
}

export function KeyValueFields({
  value,
  onChange,
  keyLabel,
  valueLabel,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const next = useRef(rows.length);
  const emitted = useRef(JSON.stringify(value));

  useEffect(() => {
    const incoming = JSON.stringify(value);
    if (incoming === emitted.current) return;
    emitted.current = incoming;
    next.current += 1000;
    setRows(toRows(value, next.current));
  }, [value]);

  const update = (rowsNext: Row[]) => {
    setRows(rowsNext);
    const record = toRecord(rowsNext);
    emitted.current = JSON.stringify(record);
    onChange(record);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-1.5">
          <Input
            value={row.key}
            placeholder={keyPlaceholder}
            aria-label={`${keyLabel} ${index + 1}`}
            spellCheck={false}
            className="font-mono text-[13px]"
            onChange={(event) =>
              update(
                rows.map((item) =>
                  item.id === row.id ? { ...item, key: event.target.value } : item,
                ),
              )
            }
          />
          <TemplateInput
            value={row.value}
            placeholder={valuePlaceholder}
            aria-label={`${valueLabel} ${index + 1}`}
            mono
            onChange={(entry) =>
              update(rows.map((item) => (item.id === row.id ? { ...item, value: entry } : item)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${keyLabel} ${row.key || index + 1} entfernen`}
            onClick={() => update(rows.filter((item) => item.id !== row.id))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        onClick={() => {
          next.current += 1;
          setRows([...rows, { id: next.current, key: "", value: "" }]);
        }}
      >
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  );
}
