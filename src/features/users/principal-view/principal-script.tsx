import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyWithToast } from "@/lib/clipboard";

export function PrincipalScript({ script }: { script: string }) {
  return (
    <div className="relative max-w-5xl">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Skript kopieren"
        className="absolute top-2 right-2"
        onClick={() => copyWithToast(script, "Skript")}
      >
        <CopyIcon />
      </Button>
      <pre className="overflow-auto rounded-2xl bg-muted/40 p-4 font-mono text-xs leading-5 whitespace-pre-wrap select-text">
        {script}
      </pre>
    </div>
  );
}
