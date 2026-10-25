import { Check, Lock } from "lucide-react";
import type { PolicyCommand } from "@/lib/db/supabase-studio-database";

export function PolicyAccessCell({
  command,
  commands,
}: {
  command: Exclude<PolicyCommand, "ALL">;
  commands: PolicyCommand[];
}) {
  const covered = commands.includes(command) || commands.includes("ALL");
  return (
    <td className="text-center">
      {covered ? (
        <span
          title={`${command}: durch Richtlinie geregelt`}
          className="inline-grid size-6 place-items-center rounded-md bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
        >
          <Check className="size-3.5" />
          <span className="sr-only">{command} geregelt</span>
        </span>
      ) : (
        <span
          title={`${command}: keine Richtlinie, über die Data API gesperrt`}
          className="inline-grid size-6 place-items-center rounded-md text-muted-foreground/50"
        >
          <Lock className="size-3" />
          <span className="sr-only">{command} gesperrt</span>
        </span>
      )}
    </td>
  );
}
