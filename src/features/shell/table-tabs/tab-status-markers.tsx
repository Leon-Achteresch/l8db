import { GitBranchIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import type { ConnectionEnvironment } from "@/lib/connections";
import { environmentInfo } from "@/lib/environments";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface TabStatusMarkersProps {
  environment: ConnectionEnvironment | null;
  transaction: boolean;
  staged?: boolean;
  isActive: boolean;
}

export function TabStatusMarkers({
  environment,
  transaction,
  staged = false,
  isActive,
}: TabStatusMarkersProps) {
  const info = environmentInfo(environment);
  const feature = useNewFeatureVisibility<HTMLSpanElement>(
    isActive && (info || transaction) ? "workspace.tab-status" : undefined,
  );
  if (!info && !transaction && !staged) return null;
  return (
    <span ref={feature.ref} className="flex shrink-0 items-center gap-1">
      {info?.value === "production" ? (
        <span
          role="img"
          aria-label={`Umgebung ${info.label}`}
          title={info.label}
          data-environment={info.value}
          className="grid h-4 place-items-center rounded-sm px-1 text-[10px] font-bold leading-none text-white"
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
      {staged && (
        <span
          role="img"
          aria-label="Nicht übernommene Änderungen"
          title="Nicht übernommene Änderungen"
          data-tab-staged=""
          className="size-1.5 rounded-full bg-amber-500"
        />
      )}
      {feature.isNew && <NewBadge />}
    </span>
  );
}
