"use client";

import * as ResizablePrimitive from "react-resizable-panels";

export function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}
