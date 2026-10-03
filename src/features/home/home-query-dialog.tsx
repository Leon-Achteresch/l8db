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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { HomeWidget } from "@/lib/home-layout";
import { useSavedQueriesStore } from "@/lib/saved-queries";

export function HomeQueryDialog({
  widget,
  onSave,
  onClose,
}: {
  widget: HomeWidget;
  onSave: (patch: Partial<HomeWidget>) => void;
  onClose: () => void;
}) {
  const saved = useSavedQueriesStore((state) => state.queries);
  const [title, setTitle] = useState(widget.title ?? "");
  const [sql, setSql] = useState(widget.sql ?? "");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ title: title.trim(), sql: sql.trim() });
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>Abfrage auf der Startseite</DialogTitle>
            <DialogDescription>
              Das Ergebnis erscheint als Tabelle auf der Startseite. Automatisch ausgeführt werden
              nur einzelne lesende Abfragen.
            </DialogDescription>
          </DialogHeader>
          {saved.length > 0 && (
            <Select
              onValueChange={(id) => {
                const query = saved.find((entry) => entry.id === id);
                if (!query) return;
                setTitle(query.name);
                setSql(query.sql);
              }}
            >
              <SelectTrigger className="w-full" aria-label="Gespeicherte Abfrage übernehmen">
                <SelectValue placeholder="Gespeicherte Abfrage übernehmen" />
              </SelectTrigger>
              <SelectContent>
                {saved.map((query) => (
                  <SelectItem key={query.id} value={query.id}>
                    {query.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            aria-label="Titel"
            placeholder="Titel"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            aria-label="Abfrage"
            placeholder="SELECT …"
            spellCheck={false}
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            className="max-h-72 min-h-40 font-mono text-xs md:text-xs"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!sql.trim()}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
