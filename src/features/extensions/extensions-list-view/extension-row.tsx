import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SPRING_LAYOUT } from "@/lib/ease";

export interface ExtensionRowProps {
  name: string;
  version: string;
  comment: string | null;
  installed: boolean;
  pending: boolean;
  onToggle: () => void;
}

export function ExtensionRow({
  name,
  version,
  comment,
  installed,
  pending,
  onToggle,
}: ExtensionRowProps) {
  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{name}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
            {version}
          </Badge>
          {installed && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-emerald-600 border-emerald-500/20 bg-emerald-500/5"
            >
              installiert
            </Badge>
          )}
        </div>
        {comment && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{comment}</p>}
      </div>
      <Button
        size="sm"
        variant={installed ? "outline" : "default"}
        className="h-7 shrink-0 text-xs"
        disabled={pending}
        onClick={onToggle}
      >
        {pending ? "…" : installed ? "Deinstallieren" : "Installieren"}
      </Button>
    </motion.div>
  );
}
