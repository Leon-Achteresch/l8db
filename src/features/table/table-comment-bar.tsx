import { MessageSquareTextIcon } from "lucide-react";
import { useTableCommentQuery } from "@/lib/queries";

export function TableCommentBar({ schema, table }: { schema: string; table: string }) {
  const { data: comment } = useTableCommentQuery(schema, table);
  if (!comment) return null;
  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b bg-muted/10 px-3 py-1.5 text-xs text-muted-foreground"
      title={comment}
    >
      <MessageSquareTextIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p className="line-clamp-2 whitespace-pre-wrap break-words">{comment}</p>
    </div>
  );
}
