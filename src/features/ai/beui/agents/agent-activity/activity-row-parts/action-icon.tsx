import { FileText, PencilLine, SquareTerminal, Wrench } from "lucide-react";

export function ActionIcon({ action }: { action: string }) {
  if (action === "read") return <FileText className="size-4" />;
  if (action === "edit" || action === "write") {
    return <PencilLine className="size-4" />;
  }
  if (action === "run") return <SquareTerminal className="size-4" />;
  return <Wrench className="size-4" />;
}
