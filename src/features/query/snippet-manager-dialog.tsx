import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  SNIPPET_PLACEHOLDER_HINT,
  findShortcutConflict,
  searchSnippets,
  snippetPlaceholders,
  useSnippetsStore,
  type Snippet,
  type SnippetInput,
} from "@/lib/snippets";

interface SnippetManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert?: (snippet: Snippet) => void;
  initialBody?: string;
}

const EMPTY_FORM: SnippetInput = {
  name: "",
  shortcut: "",
  description: "",
  category: "",
  body: "",
};

export function SnippetManagerDialog({
  open,
  onOpenChange,
  onInsert,
  initialBody,
}: SnippetManagerDialogProps) {
  const snippets = useSnippetsStore((state) => state.snippets);
  const addSnippet = useSnippetsStore((state) => state.addSnippet);
  const updateSnippet = useSnippetsStore((state) => state.updateSnippet);
  const deleteSnippet = useSnippetsStore((state) => state.deleteSnippet);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<SnippetInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedId(null);
    setError(null);
    setForm({ ...EMPTY_FORM, body: initialBody?.trim() ? initialBody : "" });
  }, [open, initialBody]);

  const filtered = useMemo(() => searchSnippets(snippets, search), [snippets, search]);
  const placeholders = useMemo(() => snippetPlaceholders(form.body), [form.body]);

  const selectSnippet = (snippet: Snippet) => {
    setSelectedId(snippet.id);
    setError(null);
    setForm({
      name: snippet.name,
      shortcut: snippet.shortcut,
      description: snippet.description,
      category: snippet.category,
      body: snippet.body,
    });
  };

  const startNew = () => {
    setSelectedId(null);
    setError(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = () => {
    const name = form.name.trim();
    const shortcut = form.shortcut.trim();
    if (!name) {
      setError("Name darf nicht leer sein.");
      return;
    }
    if (!shortcut) {
      setError("Kürzel darf nicht leer sein.");
      return;
    }
    if (/\s/.test(shortcut)) {
      setError("Kürzel darf keine Leerzeichen enthalten.");
      return;
    }
    if (!form.body.trim()) {
      setError("SQL-Text darf nicht leer sein.");
      return;
    }
    const conflict = findShortcutConflict(snippets, shortcut, selectedId ?? undefined);
    if (conflict) {
      setError(`Kürzel „${shortcut}“ wird bereits von „${conflict.name}“ verwendet.`);
      return;
    }
    setError(null);
    if (selectedId) {
      updateSnippet(selectedId, form);
    } else {
      const created = addSnippet(form);
      setSelectedId(created.id);
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deleteSnippet(selectedId);
    startNew();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>SQL-Snippets</DialogTitle>
          <DialogDescription>{SNIPPET_PLACEHOLDER_HINT}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="flex min-h-0 flex-col gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suchen…"
              className="h-8 text-xs"
            />
            <ScrollArea className="h-64 rounded-md border">
              <div className="flex flex-col p-1">
                {filtered.length === 0 && (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    Keine Snippets gefunden.
                  </p>
                )}
                {filtered.map((snippet) => (
                  <button
                    key={snippet.id}
                    type="button"
                    onClick={() => selectSnippet(snippet)}
                    onDoubleClick={() => onInsert?.(snippet)}
                    className={`rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent ${
                      snippet.id === selectedId ? "bg-accent" : ""
                    }`}
                  >
                    <span className="block truncate font-medium">{snippet.name}</span>
                    <span className="block truncate text-muted-foreground">
                      {snippet.shortcut}
                      {snippet.category ? ` · ${snippet.category}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={startNew}>
              <PlusIcon className="size-3" />
              Neu
            </Button>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="snippet-name">Name</Label>
                <Input
                  id="snippet-name"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Aktive Sessions"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="snippet-shortcut">Kürzel</Label>
                <Input
                  id="snippet-shortcut"
                  value={form.shortcut}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, shortcut: event.target.value }))
                  }
                  placeholder="sel"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="snippet-category">Kategorie</Label>
                <Input
                  id="snippet-category"
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, category: event.target.value }))
                  }
                  placeholder="Diagnose"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="snippet-description">Beschreibung</Label>
                <Input
                  id="snippet-description"
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="Kurz erklärt, was das Snippet tut"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="snippet-body">SQL-Text</Label>
              <Textarea
                id="snippet-body"
                value={form.body}
                onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                placeholder={"SELECT ${spalten:*}\nFROM ${tabelle}\nWHERE ${cursor}"}
                className="h-40 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                {placeholders.length > 0
                  ? `Platzhalter: ${placeholders.join(", ")}`
                  : "Keine Platzhalter erkannt."}
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs text-destructive"
            onClick={handleDelete}
            disabled={!selectedId}
          >
            <Trash2Icon className="size-3" />
            Löschen
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Schließen
            </Button>
            <Button size="sm" onClick={handleSave}>
              {selectedId ? "Änderungen speichern" : "Snippet anlegen"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
