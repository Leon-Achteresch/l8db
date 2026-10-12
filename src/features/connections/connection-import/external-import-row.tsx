import { AlertTriangle, Ban, Copy, KeyRound, Network } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ExternalImportCandidate } from "@/lib/connection-import";

interface Props {
  candidate: ExternalImportCandidate;
  checked: boolean;
  onToggle: (index: number) => void;
}

export function ExternalImportRow({ candidate, checked, onToggle }: Props) {
  const skipped = Boolean(candidate.skipReason);
  return (
    <label
      className={`flex h-full items-start gap-2 border-b px-2 py-2 text-sm ${skipped ? "opacity-70" : "cursor-pointer hover:bg-muted"}`}
    >
      <Checkbox
        checked={!skipped && checked}
        disabled={skipped}
        onCheckedChange={() => onToggle(candidate.index)}
        aria-label={candidate.label}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate">{candidate.label}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {candidate.product}
          </span>
          {candidate.profile?.ssh && (
            <Network className="size-3 shrink-0 text-muted-foreground" aria-label="SSH-Tunnel" />
          )}
          {candidate.password && (
            <KeyRound
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="Passwort wird übernommen"
            />
          )}
        </span>
        {candidate.folder && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {candidate.folder}
          </span>
        )}
        {candidate.skipReason ? (
          <span className="flex items-start gap-1 text-[11px] text-destructive">
            <Ban className="mt-0.5 size-3 shrink-0" />
            Wird übersprungen: {candidate.skipReason}
          </span>
        ) : (
          <>
            {candidate.duplicateOf && (
              <span className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <Copy className="mt-0.5 size-3 shrink-0" />
                Dublette von „{candidate.duplicateOf.name}“
              </span>
            )}
            {candidate.warnings.map((warning) => (
              <span
                key={warning}
                className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {warning}
              </span>
            ))}
          </>
        )}
      </span>
    </label>
  );
}
