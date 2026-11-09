import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CliExample } from "@/lib/cli-cheatsheet";
import { showCopiedMessage } from "@/lib/workspace-status";

interface CliCommandListProps {
  title?: string;
  examples: CliExample[];
}

export function CliCommandList({ title, examples }: CliCommandListProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      showCopiedMessage("Befehl kopiert.");
      setTimeout(() => setCopied((current) => (current === command ? null : current)), 1500);
    } catch {
      toast.error("Kopieren fehlgeschlagen.");
    }
  };

  return (
    <div className="space-y-1.5">
      {title ? (
        <h3 className="px-3 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {title}
        </h3>
      ) : null}
      <ul className="overflow-hidden rounded-xl bg-muted/40 py-1">
        {examples.map((example) => (
          <li
            key={example.command}
            className="group flex items-center gap-3 px-3 py-[calc(0.25rem+var(--ui-density-step)/2)] transition-colors hover:bg-muted/60"
          >
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
              <span className="mr-2 text-muted-foreground/60 select-none">$</span>
              {example.command}
            </code>
            <span className="hidden shrink-0 text-xs text-muted-foreground @min-[34rem]:block">
              {example.description}
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
              aria-label={`„${example.command}“ kopieren`}
              title="Kopieren"
              onClick={() => void copy(example.command)}
            >
              {copied === example.command ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
