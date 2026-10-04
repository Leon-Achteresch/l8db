import { type ReactNode, useState } from "react";
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

export function NameConfirmDialog({
  title,
  description,
  name,
  requireName,
  action,
  destructive,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  name: string;
  requireName: boolean;
  action: string;
  destructive?: boolean;
  children?: ReactNode;
  onConfirm: (confirm: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ready = !requireName || typed === name;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="vcs-surface sm:max-w-md">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            onConfirm(typed);
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">{description}</DialogDescription>
          </DialogHeader>
          {children}
          {requireName && (
            <label className="block space-y-1.5 text-xs">
              <span className="text-muted-foreground">
                Zur Bestätigung <span className="font-mono text-foreground">{name}</span> eingeben
              </span>
              <Input
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                aria-label="Name zur Bestätigung"
                className="font-mono"
              />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={destructive ? "destructive" : "default"}
              disabled={!ready}
            >
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
