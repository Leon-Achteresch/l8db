import { GitBranchIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import type { ConnectionEnvironment } from "@/lib/connections";
import { environmentInfo } from "@/lib/environments";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface TabStatusMarkersProps {
  environment: ConnectionEnvironment | null;
  transaction: boolean;
  isActive: boolean;
}

export function TabStatusMarkers({ environment, transaction, isActive }: TabStatusMarkersProps) {
  const info = environmentInfo(environment);
  const feature = useNewFeatureVisibility<HTMLSpanElement>(
    isActive && (info || transaction) ? "workspace.tab-status" : undefined,
  );
  if (!info && !transaction) return null;
  return (
    <span ref={feature.ref} className="flex shrink-0 items-center gap-1">
      {info?.value === "production" ? (
        <span
          role="img"
          aria-label={`Umgebung ${info.label}`}
          title={info.label}
          data-environment={info.value}
          className="grid h-3.5 place-items-center rounded-sm px-1 text-[9px] font-bold leading-none text-white"
          style={{ backgroundColor: info.color }}
        >
          P
        </span>
      ) : info ? (
        <span
          role="img"
          aria-label={`Umgebung ${info.label}`}
          title={info.label}
          data-environment={info.value}
          className="size-1.5 rounded-full"
          style={{ backgroundColor: info.color }}
        />
      ) : null}
      {transaction && (
        <GitBranchIcon
          role="img"
          aria-label="Offene Transaktion"
          data-tab-transaction=""
          className="size-3 text-primary"
        />
      )}
      {feature.isNew && <NewBadge />}
    </span>
  );
}
