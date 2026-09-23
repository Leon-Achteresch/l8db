import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActivePrompt } from "@/lib/extensions/prompts";

export function MessageDialog({
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
        <p className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-sm">
          {prompt.message}
        </p>
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
