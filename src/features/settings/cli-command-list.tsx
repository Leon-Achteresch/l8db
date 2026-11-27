import { useState } from "react";
import { toast } from "sonner";
import type { CliExample } from "@/lib/cli-cheatsheet";
import { showCopiedMessage } from "@/lib/workspace-status";
import { CliCommandRow } from "./cli-command-row";

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
          <CliCommandRow
            key={example.command}
            example={example}
            copied={copied === example.command}
            copy={copy}
          />
        ))}
      </ul>
    </div>
  );
}
