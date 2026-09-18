import { AnimatedBadge } from "@/components/motion/animated-badge";
import type { TestResult } from "./types";

export function ConnectionTestResultStatus({
  result,
  elapsed,
}: {
  result: TestResult;
  elapsed: number;
}) {
  return (
    <div aria-live="polite" className="min-h-8">
      {result.status === "testing" && (
        <AnimatedBadge status="loading" size="sm">
          Verbindung wird geprüft{elapsed > 0 ? ` · ${elapsed} s` : ""}
        </AnimatedBadge>
      )}
      {result.status === "success" && (
        <AnimatedBadge status="success" size="sm">
          Erreichbar · {result.ms} ms
        </AnimatedBadge>
      )}
      {result.status === "error" && (
        <p
          role="alert"
          className="break-words rounded-xl bg-destructive/10 p-3 text-xs leading-relaxed text-destructive"
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
