import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

async function runWindowAction(action: "minimize" | "toggleMaximize" | "close") {
  const win = getCurrentWindow();
  try {
    if (action === "minimize") await win.minimize();
    else if (action === "toggleMaximize") await win.toggleMaximize();
    else await win.close();
  } catch (error) {
    if (action === "close") {
      await win.destroy().catch(() => toast.error(`Fenster schließen: ${String(error)}`));
      return;
    }
    toast.error(`Fensteraktion fehlgeschlagen: ${String(error)}`);
  }
}

export function WindowControls() {
  const base =
    "inline-flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors cursor-pointer hover:bg-muted hover:text-foreground";
  return (
    <fieldset
      aria-label="Fenstersteuerung"
      className="absolute right-0 top-0 z-30 flex h-full items-stretch"
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        aria-label="Minimieren"
        className={base}
        onClick={() => void runWindowAction("minimize")}
      >
        <Minus className="size-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label="Maximieren"
        className={base}
        onClick={() => void runWindowAction("toggleMaximize")}
      >
        <Square className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label="Schließen"
        className={cn(base, "hover:bg-destructive hover:text-white")}
        onClick={() => void runWindowAction("close")}
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </fieldset>
  );
}
