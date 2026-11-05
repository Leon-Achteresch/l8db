import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cloudErrorText } from "./add-cloud-connection";

export function CloudSectionError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 break-words">{cloudErrorText(error)}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Erneut
        </Button>
      )}
    </div>
  );
}
