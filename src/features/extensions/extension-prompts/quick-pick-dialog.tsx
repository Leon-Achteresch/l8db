import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActivePrompt } from "@/lib/extensions/prompts";
import { cn } from "@/lib/utils";

export function QuickPickDialog({
  prompt,
  resolve,
}: {
  prompt: ActivePrompt;
  resolve: (id: string, value: never) => void;
}) {
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const [selected, setSelected] = useState<number[]>(
    (prompt.items ?? []).map((item, index) => (item.picked ? index : -1)).filter((i) => i >= 0),
  );
  const items = (prompt.items ?? []).map((item, index) => ({ ...item, index }));
  const query = filter.trim().toLowerCase();
  const visible = query
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(query) ||
          (item.description ?? "").toLowerCase().includes(query),
      )
    : items;
  const toggle = (index: number) => {
    if (prompt.canPickMany) {
      setSelected((previous) =>
        previous.includes(index) ? previous.filter((i) => i !== index) : [...previous, index],
      );
      return;
    }
    resolve(prompt.promptId, [index] as never);
  };
  const current = visible[Math.min(active, visible.length - 1)];
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((previous) => Math.max(0, Math.min(visible.length - 1, previous + step)));
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      toggle(current.index);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && resolve(prompt.promptId, undefined as never)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{prompt.title ?? "Auswählen"}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={prompt.placeholder ?? "Filtern…"}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${current.index}` : undefined}
        />
        <div
          id={listId}
          role={prompt.canPickMany ? "group" : "listbox"}
          className="max-h-64 overflow-y-auto rounded-md border"
        >
          {visible.map((item) => {
            const shared = {
              id: `${listId}-${item.index}`,
              onClick: () => toggle(item.index),
              onMouseEnter: () => setActive(visible.indexOf(item)),
              className: cn(
                "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                selected.includes(item.index) && "bg-primary/10",
                current?.index === item.index && "ring-1 ring-inset ring-ring",
              ),
            };
            const label = (
              <span key="label" className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.label}</span>
                {item.description && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
            );
            return prompt.canPickMany ? (
              <button
                key={item.index}
                type="button"
                role="checkbox"
                tabIndex={-1}
                aria-checked={selected.includes(item.index)}
                {...shared}
              >
                <span aria-hidden>{selected.includes(item.index) ? "☑" : "☐"}</span>
                {label}
              </button>
            ) : (
              <div
                key={item.index}
                role="option"
                tabIndex={-1}
                aria-selected={current?.index === item.index}
                onKeyDown={(event) => event.key === "Enter" && toggle(item.index)}
                {...shared}
              >
                {label}
              </div>
            );
          })}
          {visible.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">Keine Treffer.</p>
          )}
        </div>
        {prompt.canPickMany && (
          <DialogFooter>
            <Button variant="outline" onClick={() => resolve(prompt.promptId, undefined as never)}>
              Abbrechen
            </Button>
            <Button onClick={() => resolve(prompt.promptId, selected as never)}>
              Übernehmen ({selected.length})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
