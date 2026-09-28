import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { reportCrash } from "@/lib/crash-reporting";
import { recordDiagnosticError } from "@/lib/diagnostics";
import { errorMessageOf } from "@/lib/error-details";
import { PanelErrorFallback } from "./panel-error-fallback";

export function PanelErrorBoundary({
  label,
  source,
  compact,
  className,
  resetKeys,
  children,
}: {
  label: string;
  source: string;
  compact?: boolean;
  className?: string;
  resetKeys?: unknown[];
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error) => {
        recordDiagnosticError(`panel.${source}`, errorMessageOf(error));
        reportCrash(error);
      }}
      fallbackRender={(props) => (
        <PanelErrorFallback {...props} label={label} compact={compact} className={className} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
