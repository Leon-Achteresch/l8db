import { ArrowRight } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import type { DriverDiagnosis } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

const DOT = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
} as const;

export function DriverFindings({ diagnosis }: { diagnosis: DriverDiagnosis }) {
  const badge = useNewFeatureVisibility<HTMLDivElement>("drivers.repair");
  return (
    <div ref={badge.ref} className="space-y-3">
      <div className="space-y-1.5">
        <p className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          Analyse
          {badge.isNew && <NewBadge />}
        </p>
        <ul className="space-y-1.5">
          {diagnosis.findings.map((finding) => (
            <li key={`${finding.title}:${finding.detail}`} className="flex min-w-0 gap-2">
              <span
                aria-hidden
                className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT[finding.level])}
              />
              <div className="min-w-0">
                <p className="text-xs font-medium">{finding.title}</p>
                {finding.detail && (
                  <p
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={finding.detail}
                  >
                    {finding.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {(diagnosis.steps.length > 0 || diagnosis.manual) && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Lösung</p>
          <ol className="space-y-1">
            {diagnosis.steps.map((step) => (
              <li key={step} className="flex items-center gap-2 text-xs">
                <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                {step}
              </li>
            ))}
          </ol>
          {diagnosis.manual && (
            <p className="rounded-lg bg-muted/40 p-2 font-mono text-[11px] break-words select-text">
              {diagnosis.manual}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
