import { PencilIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import type { SequenceInfo } from "@/lib/db";

interface SequenceRowProps {
  seq: SequenceInfo;
  editable: boolean;
  onEdit: (seq: SequenceInfo) => void;
}

export const SequenceRow = memo(function SequenceRow({ seq, editable, onEdit }: SequenceRowProps) {
  return (
    <tr className="h-[33px] hover:bg-muted/40 group">
      <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{seq.schema}</td>
      <td className="px-4 py-2 font-medium font-mono text-xs">{seq.name}</td>
      <td className="px-4 py-2 text-muted-foreground text-xs">{seq.data_type}</td>
      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{seq.start_value}</td>
      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {seq.min_value}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {seq.max_value}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{seq.increment_by}</td>
      <td className="px-4 py-2 text-center text-xs">{seq.cycle ? "Ja" : "Nein"}</td>
      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
        {seq.last_value ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-2 text-right">
        {editable && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onEdit(seq)}
          >
            <PencilIcon className="size-3.5" />
          </Button>
        )}
      </td>
    </tr>
  );
});
