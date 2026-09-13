import { Link } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

interface TableDataErrorProps {
  title: string;
  error: unknown;
  actions?: ReactNode;
  onRetry?: () => void;
}

export function TableDataError({ title, error, actions, onRetry }: TableDataErrorProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 border-t border-border bg-background">
      <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
        <TriangleAlertIcon className="size-8 text-destructive" />
        <h3 className="text-sm font-semibold text-destructive">{title}</h3>
        <p
          role="alert"
          className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text"
        >
          {String(error)}
        </p>
        {actions ? <div className="flex flex-wrap justify-center gap-2 pt-1">{actions}</div> : null}
        <div className="flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Erneut versuchen
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void copyText(String(error))
                .then(() => toast.success("Fehlerdetails kopiert"))
                .catch((failure) => toast.error(String(failure)))
            }
          >
            Details kopieren
          </Button>
          <Link
            to="/connections"
            className="inline-flex items-center rounded-md px-3 text-xs underline underline-offset-4"
          >
            Verbindung bearbeiten
          </Link>
        </div>
      </div>
    </div>
  );
}
