import { CommandIcon, DatabaseIcon } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { Spinner } from "@/components/ui/spinner";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";

interface SidebarConnectionTriggerContentProps {
  isSwitching: boolean;
  switchTarget: SavedConnection | undefined;
  activeConnection: SavedConnection | null;
}

export function SidebarConnectionTriggerContent({
  isSwitching,
  switchTarget,
  activeConnection,
}: SidebarConnectionTriggerContentProps) {
  return (
    <>
      {isSwitching ? (
        <Spinner className="size-4 shrink-0" />
      ) : activeConnection ? (
        <ProviderLogo
          providerId={providerFor(activeConnection).id}
          kind={activeConnection.kind}
          className="size-4"
        />
      ) : (
        <DatabaseIcon className="size-4 shrink-0 text-primary" />
      )}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">
          {isSwitching
            ? switchTarget
              ? `Verbinde… ${switchTarget.name}`
              : "Verbinde…"
            : activeConnection
              ? activeConnection.name
              : "Keine Verbindung"}
        </span>
        {!isSwitching && activeConnection?.tags?.[0] && (
          <span
            className="inline-flex max-w-20 shrink-0 truncate rounded px-1.5 py-px text-[9px] font-medium text-white"
            style={{ backgroundColor: activeConnection.tags[0].color }}
          >
            {activeConnection.tags[0].name}
          </span>
        )}
        {!isSwitching && (activeConnection?.tags?.length ?? 0) > 1 && (
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
            +{(activeConnection?.tags?.length ?? 0) - 1}
          </span>
        )}
      </span>
      <CommandIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}
