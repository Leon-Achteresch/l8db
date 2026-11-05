import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { PipelineProgress } from "@/lib/versioning/pipeline";
import { ledgerDetail } from "@/lib/versioning/workflow";

export function VersioningLedgerSummary({ progress }: { progress: PipelineProgress }) {
  const detail = ledgerDetail(progress);
  const feature = useNewFeatureVisibility<HTMLSpanElement>(
    detail ? "versioning.targets.ledger" : undefined,
  );
  return (
    <span ref={feature.ref} className="inline-flex items-center gap-1">
      {progress.label}
      {detail && <span className="text-muted-foreground">· {detail}</span>}
      {feature.isNew && <NewBadge />}
    </span>
  );
}
