import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type ActivePrompt, useExtensionPrompts } from "@/lib/extensions/prompts";
import { cn } from "@/lib/utils";

export function ExtensionPrompts() {
  const pending = useExtensionPrompts((state) => state.pending);
  const resolve = useExtensionPrompts((state) => state.resolve);
  return (
    <>
      {pending.map((prompt) => (
        <PromptDialog key={prompt.promptId} prompt={prompt} resolve={resolve} />
      ))}
    </>
  );
}

function PromptDialog({
  prompt,
  resolve,
}: {
  prompt: ActivePrompt;
  resolve: (id: string, value: never) => void;
}) {
  if (prompt.kind === "quickPick") return <QuickPickDialog prompt={prompt} resolve={resolve} />;
  if (prompt.kind === "inputBox") return <InputBoxDialog prompt={prompt} resolve={resolve} />;
  return <MessageDialog prompt={prompt} resolve={resolve} />;
}

function QuickPickDialog({
  prompt,
  resolve,
}: {
  prompt: ActivePrompt;
  resolve: (id: string, value: never) => void;
}) {
  const [filter, setFilter] = useState("");
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
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {visible.map((item) => (
            <button
              key={item.index}
              type="button"
              onClick={() => toggle(item.index)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                selected.includes(item.index) && "bg-primary/10",
              )}
            >
              {prompt.canPickMany && (
                <span aria-hidden>{selected.includes(item.index) ? "☑" : "☐"}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.label}</span>
                {item.description && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          ))}
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

function InputBoxDialog({
  prompt,
  resolve,
}: {
  prompt: ActivePrompt;
  resolve: (id: string, value: never) => void;
}) {
  const [value, setValue] = useState(prompt.defaultValue ?? "");
  return (
    <Dialog open onOpenChange={(open) => !open && resolve(prompt.promptId, undefined as never)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{prompt.title ?? "Eingabe"}</DialogTitle>
        </DialogHeader>
        {prompt.message && <p className="text-sm text-muted-foreground">{prompt.message}</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            resolve(prompt.promptId, value as never);
          }}
        >
          <Input
            autoFocus
            type={prompt.password ? "password" : "text"}
            placeholder={prompt.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => resolve(prompt.promptId, undefined as never)}
            >
              Abbrechen
            </Button>
            <Button type="submit">Übernehmen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MessageDialog({
  prompt,
  resolve,
}: {
  prompt: ActivePrompt;
  resolve: (id: string, value: never) => void;
}) {
  const actions = prompt.actions ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && resolve(prompt.promptId, undefined as never)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {prompt.level === "error"
              ? "Fehler"
              : prompt.level === "warning"
                ? "Warnung"
                : "Hinweis"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm">{prompt.message}</p>
        <DialogFooter>
          {actions.length === 0 ? (
            <Button onClick={() => resolve(prompt.promptId, undefined as never)}>OK</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => resolve(prompt.promptId, undefined as never)}
              >
                Abbrechen
              </Button>
              {actions.map((action) => (
                <Button key={action} onClick={() => resolve(prompt.promptId, action as never)}>
                  {action}
                </Button>
              ))}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
