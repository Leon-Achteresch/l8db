import { PuzzleIcon } from "lucide-react";
import { gt } from "semver";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ExtensionDescriptor } from "@/lib/extensions/contracts";
import type { MarketExtension } from "@/lib/extensions/market";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { PASSWORD_MANAGER_ID } from "./password-manager";

export function ExtensionMarketCard({
  entry,
  community,
  installed,
  pending,
  onInstall,
}: {
  entry: MarketExtension;
  community: boolean;
  installed?: ExtensionDescriptor;
  pending: boolean;
  onInstall: () => void;
}) {
  const updateAvailable =
    installed !== undefined && gt(entry.version, installed.archive.manifest.version);
  const openbao = useNewFeatureVisibility<HTMLElement>(
    entry.id === PASSWORD_MANAGER_ID && !installed
      ? "settings.extensions.extensions.openbao"
      : undefined,
  );
  return (
    <article
      ref={openbao.ref}
      aria-label={entry.name}
      className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs"
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
      >
        <PuzzleIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm font-semibold">{entry.name}</strong>
          {openbao.isNew && <NewBadge />}
          <Badge variant="outline">{community ? "Community" : "Offiziell"}</Badge>
          <span className="text-xs text-muted-foreground tabular-nums">v{entry.version}</span>
          {community && (
            <span className="text-xs text-muted-foreground">von {entry.publisher}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{entry.description}</p>
      </div>
      <Button
        size="sm"
        variant={installed && !updateAvailable ? "ghost" : "default"}
        disabled={pending || (installed !== undefined && !updateAvailable)}
        onClick={onInstall}
      >
        {pending && <Spinner />}
        {pending
          ? "Lädt …"
          : updateAvailable
            ? "Aktualisieren"
            : installed
              ? "Installiert"
              : "Installieren"}
      </Button>
    </article>
  );
}
