import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { commitStorageAndReload } from "@/lib/app-storage";
import { formatBytes, PROTECTED_STORAGE_KEYS, storageLabel } from "@/lib/storage-usage";

const EDIT_LIMIT = 1_000_000;

function readable(value: string) {
  if (value.length > EDIT_LIMIT) return { text: value.slice(0, 200_000), json: false };
  try {
    return { text: JSON.stringify(JSON.parse(value), null, 2), json: true };
  } catch {
    return { text: value, json: false };
  }
}

interface Props {
  storageKey: string;
  value: string;
  onOpenChange: (open: boolean) => void;
}

export function StorageEntryDialog({ storageKey, value, onOpenChange }: Props) {
  const [initial] = useState(() => readable(value));
  const [text, setText] = useState(initial.text);
  const [error, setError] = useState<string>();
  const editable = !PROTECTED_STORAGE_KEYS.has(storageKey) && value.length <= EDIT_LIMIT;

  const save = () => {
    if (localStorage.getItem(storageKey) !== value) {
      setError("Inzwischen geändert, bitte neu öffnen");
      return;
    }
    let next = text;
    try {
      next = JSON.stringify(JSON.parse(text));
    } catch {
      if (initial.json) {
        setError("Kein gültiges JSON");
        return;
      }
    }
    void commitStorageAndReload({ [storageKey]: next });
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{storageLabel(storageKey)}</DialogTitle>
          <DialogDescription className="font-mono text-xs tabular-nums">
            {storageKey} · {formatBytes((storageKey.length + value.length) * 2)}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label={`Inhalt von ${storageLabel(storageKey)}`}
          value={text}
          readOnly={!editable}
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setError(undefined);
          }}
          className="min-h-80 flex-1 resize-none font-mono text-xs"
        />
        <DialogFooter className="items-center">
          {error ? <span className="mr-auto text-xs text-destructive">{error}</span> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {editable ? "Abbrechen" : "Schließen"}
          </Button>
          {editable ? (
            <Button onClick={save} disabled={text === initial.text}>
              Speichern & neu laden
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
