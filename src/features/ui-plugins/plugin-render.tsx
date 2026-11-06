import type { ReactNode } from "react";

export function PluginRender({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}
