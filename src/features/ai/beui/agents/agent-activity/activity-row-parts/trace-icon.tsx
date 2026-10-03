import {
  ImageIcon,
  MessageSquare,
  PencilLine,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { AgentActivityTrace } from "../types";

export function TraceIcon({ kind }: { kind: AgentActivityTrace["kind"] }) {
  if (kind === "thinking") return <Sparkles className="size-4" />;
  if (kind === "message") return <MessageSquare className="size-4" />;
  if (kind === "write") return <PencilLine className="size-4" />;
  if (kind === "run") return <SquareTerminal className="size-4" />;
  if (kind === "read") return <ImageIcon className="size-4" />;
  return <Wrench className="size-4" />;
}
