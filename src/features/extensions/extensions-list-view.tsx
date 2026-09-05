import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, PackageIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveConnection } from "@/lib/connections";
import { effectiveConnectionString } from "@/lib/ssh";
import { installExtension, uninstallExtension } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useAvailableExtensionsQuery } from "@/lib/queries";

export function AvailableExtensionsView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const { data: extensions, isLoading, isError, error } = useAvailableExtensionsQuery();

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full bg-muted/30" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5">
          <TriangleAlertIcon className="size-8 text-destructive" />
          <p className="text-xs text-muted-foreground font-mono break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = (extensions ?? []).filter(
    (ext) =>
      !q ||
      ext.name.toLowerCase().includes(q) ||
      (ext.comment ?? "").toLowerCase().includes(q),
  );

  const handleToggle = async (name: string, installed: boolean) => {
    setPending(name);
    try {
      if (installed) {
        await uninstallExtension(
          connection.kind,
          effectiveConnectionString(connection),
          name,
          database ?? undefined,
        );
        toast.success(`Extension "${name}" deinstalliert.`);
      } else {
        await installExtension(
          connection.kind,
          effectiveConnectionString(connection),
          name,
          undefined,
          database ?? undefined,
        );
        toast.success(`Extension "${name}" installiert.`);
      }
      await queryClient.invalidateQueries({ queryKey: ["extensions"] });
      await queryClient.invalidateQueries({ queryKey: ["available-extensions"] });
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setPending(null);
    }
  };

  const installed = filtered.filter((e) => e.installed);
  const available = filtered.filter((e) => !e.installed);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <PackageIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Extensions
        </span>
        {extensions && (
          <span className="text-xs text-muted-foreground">
            {extensions.filter((e) => e.installed).length} installiert ·{" "}
            {extensions.length} verfügbar
          </span>
        )}
        <div className="relative ml-auto max-w-xs flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suche…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {installed.length > 0 && (
          <section>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
              <CheckIcon className="size-4 text-emerald-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Installiert
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {installed.length}
              </span>
            </div>
            <div className="divide-y">
              {installed.map((ext) => (
                <ExtensionRow
                  key={ext.name}
                  name={ext.name}
                  version={ext.default_version}
                  comment={ext.comment}
                  installed={true}
                  pending={pending === ext.name}
                  onToggle={() => void handleToggle(ext.name, true)}
                />
              ))}
            </div>
          </section>
        )}

        {available.length > 0 && (
          <section>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
              <PackageIcon className="size-4 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Verfügbar
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {available.length}
              </span>
            </div>
            <div className="divide-y">
              {available.map((ext) => (
                <ExtensionRow
                  key={ext.name}
                  name={ext.name}
                  version={ext.default_version}
                  comment={ext.comment}
                  installed={false}
                  pending={pending === ext.name}
                  onToggle={() => void handleToggle(ext.name, false)}
                />
              ))}
            </div>
          </section>
        )}

        {filtered.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">Keine Treffer.</p>
        )}
      </div>
    </div>
  );
}

interface ExtensionRowProps {
  name: string;
  version: string;
  comment: string | null;
  installed: boolean;
  pending: boolean;
  onToggle: () => void;
}

function ExtensionRow({ name, version, comment, installed, pending, onToggle }: ExtensionRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{name}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
            {version}
          </Badge>
          {installed && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-emerald-600 border-emerald-500/20 bg-emerald-500/5"
            >
              installiert
            </Badge>
          )}
        </div>
        {comment && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{comment}</p>
        )}
      </div>
      <Button
        size="sm"
        variant={installed ? "outline" : "default"}
        className="h-7 shrink-0 text-xs"
        disabled={pending}
        onClick={onToggle}
      >
        {pending ? "…" : installed ? "Deinstallieren" : "Installieren"}
      </Button>
    </div>
  );
}
