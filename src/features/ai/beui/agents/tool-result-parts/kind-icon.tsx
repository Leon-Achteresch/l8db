import { Braces, SquareTerminal, Wrench } from "lucide-react";
import type { ToolResultKind } from "./shared";

export function KindIcon({ kind }: { kind: ToolResultKind }) {
  if (kind === "terminal") return <SquareTerminal className="size-4" />;
  if (kind === "request") return <Braces className="size-4" />;
  return <Wrench className="size-4" />;
}
