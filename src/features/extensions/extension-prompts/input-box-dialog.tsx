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
import type { ActivePrompt } from "@/lib/extensions/prompts";

export function InputBoxDialog({
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
