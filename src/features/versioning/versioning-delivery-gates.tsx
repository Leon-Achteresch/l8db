import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { type DeliveryReport, GATE_LABELS } from "@/lib/versioning/delivery";
import { openForgeUrl } from "@/lib/versioning/forge";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningDeliveryGates({
  workspace,
  report,
  problems = [],
}: {
  workspace: VersioningWorkspace;
  report: DeliveryReport;
  problems?: string[];
}) {
  return (
    <ul className="mt-2 space-y-1.5 rounded-lg bg-muted/30 p-2.5">
      {report.gates.map((gate) => {
        const Icon = gate.ok ? CircleCheckIcon : CircleXIcon;
        return (
          <li key={gate.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <Icon
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                gate.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
              )}
            />
            <span className="min-w-0">
              <span className="font-medium">{GATE_LABELS[gate.id]}:</span> {gate.detail}
              {gate.id === "test" &&
                !gate.ok &&
                problems.length > 0 &&
                ` (${problems.join(" · ")})`}
              {gate.evidence.map((entry) => (
                <button
                  key={`${entry.release}-${entry.commit}`}
                  type="button"
                  className="ml-1 text-primary underline-offset-2 hover:underline"
                  onClick={() => void workspace.run(() => openForgeUrl(entry.url))}
                >
                  #{entry.number} ({entry.approvals.join(", ") || "ohne Freigabe"})
                </button>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
