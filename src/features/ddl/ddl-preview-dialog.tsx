import { CopyIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

interface DdlPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  ddl: string;
  ddlError: string | null;
  isLoading: boolean;
  confirmLabel: string;
  confirmDisabled?: boolean;
  destructive?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

export function DdlPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  ddl,
  ddlError,
  isLoading,
  confirmLabel,
  confirmDisabled = false,
  destructive = false,
  isPending = false,
  onConfirm,
  children,
}: DdlPreviewDialogProps) {
  const copyDdl = async () => {
    if (!ddl) return;
    try {
      await navigator.clipboard.writeText(ddl);
      toast.success("SQL kopiert.");
    } catch {
      toast.error("SQL konnte nicht kopiert werden.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4">
          {children}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">DDL-Vorschau</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={!ddl}
                onClick={() => void copyDdl()}
              >
                <CopyIcon className="size-3" />
                Kopieren
              </Button>
            </div>
            {ddl ? (
              <Textarea
                readOnly
                value={ddl}
                spellCheck={false}
                rows={Math.min(12, ddl.split("\n").length + 1)}
                className="resize-none bg-muted/30 font-mono text-xs"
              />
            ) : (
              <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                {ddlError ?? (isLoading ? "Vorschau wird geladen…" : "Keine Vorschau verfügbar.")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Abbrechen
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={confirmDisabled || isPending || !ddl || Boolean(ddlError)}
            onClick={onConfirm}
          >
            {isPending ? <Spinner className="size-4" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
