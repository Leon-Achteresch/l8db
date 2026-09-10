import { RefreshCw, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface Props {
  selected: string[];
  scanned: string[] | null;
  scanning: boolean;
  error: string | null;
  onScan: () => void;
  onChange: (next: string[]) => void;
}

export function SchemaPicker({ selected, scanned, scanning, error, onScan, onChange }: Props) {
  const [search, setSearch] = useState("");
  const all = useMemo(
    () => [...new Set([...(scanned ?? []), ...selected])].sort((a, b) => a.localeCompare(b)),
    [scanned, selected],
  );
  const needle = search.trim().toLowerCase();
  const visible = needle ? all.filter((name) => name.toLowerCase().includes(needle)) : all;
  const selectedSet = new Set(selected);
  const missing = scanned ? selected.filter((name) => !scanned.includes(name)) : [];

  function toggle(name: string, checked: boolean) {
    if (checked) onChange([...selected, name]);
    else onChange(selected.filter((entry) => entry !== name));
  }

  function setVisible(checked: boolean) {
    const names = new Set(visible);
    if (checked) onChange([...new Set([...selected, ...visible])]);
    else onChange(selected.filter((entry) => !names.has(entry)));
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Sichtbare Schemas</legend>
      <p className="text-xs text-muted-foreground">
        Ohne Auswahl werden alle Schemas angezeigt. Scanne die Verbindung und wähle die Schemas aus,
        die in der Seitenleiste und in Auswahllisten erscheinen sollen.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={scanning} onClick={onScan}>
          {scanning ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <ScanSearch className="size-3.5" />
          )}
          {scanned ? "Erneut scannen" : "Schemas scannen"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {selected.length === 0
            ? scanned
              ? `${scanned.length} gefunden · alle sichtbar`
              : "Alle sichtbar"
            : `${selected.length} von ${all.length} ausgewählt`}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => onChange([])}
          >
            Auswahl aufheben
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {all.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border p-2">
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`${all.length} Schemas durchsuchen…`}
              aria-label="Schemas durchsuchen"
              className="h-8 text-xs"
            />
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground underline"
              disabled={visible.length === 0}
              onClick={() => setVisible(true)}
            >
              Alle
            </button>
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground underline"
              disabled={visible.length === 0}
              onClick={() => setVisible(false)}
            >
              Keine
            </button>
          </div>
          <ul className="max-h-56 overflow-y-auto pr-1">
            {visible.map((name) => (
              <li key={name}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                  <Checkbox
                    checked={selectedSet.has(name)}
                    onCheckedChange={(checked) => toggle(name, checked === true)}
                    aria-label={name}
                  />
                  <span className="truncate font-mono">{name}</span>
                  {missing.includes(name) && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      nicht gefunden
                    </span>
                  )}
                </label>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-1 py-2 text-xs text-muted-foreground">Keine Treffer.</li>
            )}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
