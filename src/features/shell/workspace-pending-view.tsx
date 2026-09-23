import { LoaderCircleIcon } from "lucide-react";

export function WorkspacePendingView({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
    >
      <LoaderCircleIcon aria-hidden="true" className="size-4 motion-safe:animate-spin" />
      <span>{label} wird geöffnet…</span>
    </div>
  );
}
