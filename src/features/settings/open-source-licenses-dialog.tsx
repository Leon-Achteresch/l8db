import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { licenseSections } from "@/lib/third-party-licenses";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OpenSourceLicensesDialog({ open, onOpenChange }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || text !== null) return;
    fetch("/third-party-licenses.txt")
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then(setText)
      .catch(() => setFailed(true));
  }, [open, text]);

  const sections = useMemo(() => licenseSections(text ?? "", query), [text, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Open-Source-Lizenzen</DialogTitle>
          <DialogDescription>
            l8db steht unter der Apache License 2.0 und enthält die folgenden Komponenten Dritter.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Paket oder Lizenz suchen"
          aria-label="Paket oder Lizenz suchen"
        />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/30">
          {failed ? (
            <p className="p-4 text-sm text-muted-foreground">
              Die Lizenzliste ist nur in Release-Builds enthalten.
            </p>
          ) : text === null ? (
            <p className="p-4 text-sm text-muted-foreground">Lizenzen werden geladen…</p>
          ) : sections.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Keine Treffer.</p>
          ) : (
            sections.map((section) => (
              <pre
                key={section.slice(0, 200)}
                dir="auto"
                className="whitespace-pre-wrap break-words border-b p-4 font-mono text-[11px] leading-relaxed [contain-intrinsic-size:auto_600px] [content-visibility:auto]"
              >
                {section}
              </pre>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
