import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "./use-storage-connection";

export function SettingsCard({
  title,
  description,
  loading = false,
  error = null,
  unsupported = false,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  loading?: boolean;
  error?: unknown;
  unsupported?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-label={title}>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </header>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> Lade…
        </div>
      ) : unsupported ? (
        <p className="text-xs text-muted-foreground">Wird von diesem Server nicht unterstützt.</p>
      ) : error ? (
        <p className="text-xs break-words text-destructive">{errorText(error)}</p>
      ) : (
        children
      )}
    </section>
  );
}
