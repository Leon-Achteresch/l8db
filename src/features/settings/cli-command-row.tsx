import { Check, Copy } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import type { CliExample } from "@/lib/cli-cheatsheet";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function CliCommandRow({
  example,
  copied,
  copy,
}: {
  example: CliExample;
  copied: boolean;
  copy: (command: string) => Promise<void>;
}) {
  const feature = useNewFeatureVisibility<HTMLLIElement>(example.featureId);
  return (
    <li
      ref={feature.ref}
      className="group flex items-center gap-3 px-3 py-[calc(0.25rem+var(--ui-density-step)/2)] transition-colors hover:bg-muted/60"
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
        <span className="mr-2 text-muted-foreground select-none">$</span>
        {example.command}
      </code>
      <span className="hidden shrink-0 text-xs text-muted-foreground @min-[34rem]:block">
        {example.description}
      </span>
      {feature.isNew && <NewBadge />}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        aria-label={`„${example.command}“ kopieren`}
        title="Kopieren"
        onClick={() => void copy(example.command)}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </li>
  );
}
