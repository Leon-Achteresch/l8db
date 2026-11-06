import { SplitDropPreview } from "@/features/shell/split-workspace/split-drop-preview";

export function NewPaneDropZone() {
  return (
    <div data-drop-zone="pane:single" className="pointer-events-none absolute inset-0">
      <SplitDropPreview pane="single" />
    </div>
  );
}
