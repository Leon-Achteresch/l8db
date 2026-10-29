import type { ReactNode } from "react";
import type { PluginNode } from "@/lib/ui-plugins/registry";
import { PluginBoundary } from "./plugin-boundary";

const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end" } as const;

export function PluginCell({
  output,
  align,
  fallback,
  resetKey,
}: {
  output: PluginNode;
  align: "start" | "center" | "end" | undefined;
  fallback: ReactNode;
  resetKey: unknown;
}) {
  return (
    <span
      data-ui-plugin={output.plugin}
      className="flex h-5 min-w-0 items-center gap-1 overflow-hidden font-sans"
      style={{ contain: "layout paint", justifyContent: align ? JUSTIFY[align] : undefined }}
    >
      <PluginBoundary plugin={output.plugin} fallback={fallback} resetKey={resetKey}>
        {output.node}
      </PluginBoundary>
    </span>
  );
}
