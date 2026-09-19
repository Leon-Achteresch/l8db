import { ChevronsUpDownIcon, DatabaseIcon } from "lucide-react";
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
        <span className="truncate">
          {isSwitching
            ? switchTarget
              ? `Verbinde… ${switchTarget.name}`
              : "Verbinde…"
            : activeConnection
              ? activeConnection.name
              : "Keine Verbindung"}
        </span>
        {isSwitching
          ? null
          : activeConnection?.tags?.map((tag, index) => (
              <span
                key={index}
                className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[9px] font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </span>
            ))}
      </span>
      <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
    </>
  );
}
