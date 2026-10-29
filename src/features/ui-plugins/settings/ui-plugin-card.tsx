import { AlertTriangleIcon, GlobeIcon, PuzzleIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { resolveOptions } from "@/lib/ui-plugins/api";
import { useUiPluginSettings } from "@/lib/ui-plugins/settings";
import type { UiPluginStatus } from "@/lib/ui-plugins/status";
import { UiPluginOptions } from "./ui-plugin-options";

const STATE_LABEL = {
  active: "Aktiv",
  disabled: "Aus",
  error: "Fehler",
  stale: "Fehler · alte Version läuft",
} as const;

export function UiPluginCard({
  status,
  onRemove,
}: {
  status: UiPluginStatus;
  onRemove?: () => void;
}) {
  const setEnabled = useUiPluginSettings((state) => state.setEnabled);
  const grantHttp = useUiPluginSettings((state) => state.grantHttp);
  const revokeHttp = useUiPluginSettings((state) => state.revokeHttp);
  const stored = useUiPluginSettings((state) => (status.id ? state.options[status.id] : undefined));
  const faults = [
    ...Object.entries(status.tripped).map(([slot, reason]) => `${slot} abgeschaltet: ${reason}`),
    ...Object.entries(status.slotErrors).map(([slot, message]) => `${slot}: ${message}`),
    ...(status.runtimeError ? [status.runtimeError] : []),
  ];
  const missingGrants = status.http.filter((pattern) => !status.granted.includes(pattern));
  return (
    <article
      aria-label={status.name ?? status.file}
      data-ui-plugin-status={status.state}
      className="@container space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
        >
          <PuzzleIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm font-semibold">{status.name ?? status.file}</strong>
            <Badge
              variant={
                status.state === "active"
                  ? "secondary"
                  : status.state === "disabled"
                    ? "outline"
                    : "destructive"
              }
            >
              {STATE_LABEL[status.state]}
            </Badge>
            {status.version && (
              <span className="text-xs text-muted-foreground tabular-nums">v{status.version}</span>
            )}
            {status.author && (
              <span className="text-xs text-muted-foreground">von {status.author}</span>
            )}
          </div>
          {status.description && (
            <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{status.description}</p>
          )}
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {status.file}
            {status.id ? ` · ${status.id}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onRemove && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${status.name ?? status.file} entfernen`}
              onClick={onRemove}
            >
              <Trash2Icon />
            </Button>
          )}
          {status.id && (
            <Switch
              aria-label={`${status.name ?? status.file} aktivieren`}
              checked={status.state !== "disabled"}
              onCheckedChange={(checked) => status.id && setEnabled(status.id, checked)}
            />
          )}
        </div>
      </div>
      {status.error && (
        <p
          role="alert"
          className="flex gap-2 rounded-xl bg-destructive/10 p-3 font-mono text-xs text-destructive"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {status.error.line ? `Zeile ${status.error.line}: ` : ""}
            {status.error.message}
          </span>
        </p>
      )}
      {faults.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          {faults.map((fault) => (
            <li key={fault} className="break-words">
              {fault}
            </li>
          ))}
        </ul>
      )}
      {status.http.length > 0 && status.id && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3 text-xs">
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            Netzwerk:{" "}
            {status.http.map((pattern) => (
              <code key={pattern} className="mr-1 rounded bg-background px-1 py-0.5">
                {pattern}
              </code>
            ))}
          </span>
          {missingGrants.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => status.id && grantHttp(status.id, status.http)}
            >
              Freigeben
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => status.id && revokeHttp(status.id)}>
              Freigabe entziehen
            </Button>
          )}
        </div>
      )}
      {status.id && status.state !== "error" && (
        <UiPluginOptions
          id={status.id}
          specs={status.options}
          values={resolveOptions(status.options, stored)}
        />
      )}
    </article>
  );
}
