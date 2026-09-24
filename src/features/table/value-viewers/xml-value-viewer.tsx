import { CheckCircle2Icon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copyText } from "@/lib/clipboard";
import { formatXml, parseXml } from "@/lib/value-viewers/xml";
import { XmlTreeNode } from "./xml-tree-node";

export function XmlValueViewer({ text }: { text: string }) {
  const parsed = useMemo(() => parseXml(text), [text]);
  const formatted = useMemo(() => formatXml(text), [text]);
  const [mode, setMode] = useState<"tree" | "pretty">(parsed.document ? "tree" : "pretty");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={mode}
            onValueChange={(next) => next && setMode(next as typeof mode)}
          >
            <ToggleGroupItem value="tree" disabled={!parsed.document}>
              Baum
            </ToggleGroupItem>
            <ToggleGroupItem value="pretty">Formatiert</ToggleGroupItem>
          </ToggleGroup>
          {parsed.document ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2Icon className="size-3.5" />
              Wohlgeformt
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <TriangleAlertIcon className="size-3.5" />
              Ungültiges XML
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await copyText(formatted);
            toast.success("Formatiertes XML kopiert");
          }}
        >
          <CopyIcon className="size-3.5" />
          Formatiert kopieren
        </Button>
      </div>
      {parsed.error && (
        <p className="line-clamp-3 font-mono text-xs text-destructive" data-testid="xml-error">
          {parsed.error}
        </p>
      )}
      <div className="h-[45vh] overflow-auto rounded-lg border border-border/80 bg-muted/45 p-3 font-mono text-xs leading-relaxed shadow-inner">
        {mode === "tree" && parsed.document ? (
          <XmlTreeNode node={parsed.document.documentElement} depth={0} />
        ) : (
          <pre className="whitespace-pre-wrap break-words">{formatted}</pre>
        )}
      </div>
    </div>
  );
}
