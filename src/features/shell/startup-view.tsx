import { Database } from "lucide-react";

export function StartupView() {
  return (
    <main className="workspace-canvas grid h-dvh place-items-center">
      <div role="status" className="text-center">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl border bg-card">
          <Database className="size-5 text-primary" />
        </div>
        <p className="text-lg font-semibold tracking-tight">l8db</p>
        <p className="mt-2 text-xs text-muted-foreground">Arbeitsplatz wird vorbereitet…</p>
      </div>
    </main>
  );
}
