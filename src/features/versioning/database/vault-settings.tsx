import { CopyIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/backup";
import { branchingRecoveryImport, branchingRecoveryKey } from "@/lib/db";
import { showCopiedMessage } from "@/lib/workspace-status";
import { VersioningIconButton } from "../versioning-icon-button";
import { NameConfirmDialog } from "./name-confirm-dialog";
import type { BranchingWorkspace } from "./use-branching";

export function VaultSettings({ workspace }: { workspace: BranchingWorkspace }) {
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [recovery, setRecovery] = useState("");
  const vault = workspace.overview?.vault;
  if (!vault) return null;
  const facts = [
    ["Speicherort", vault.path],
    ["Tresor-ID", vault.id],
    ["Schlüssel", vault.fingerprint],
    ["Inhalt", `${vault.snapshots} Sicherungen · ${formatBytes(vault.bytes)}`],
  ] as const;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-muted/40 p-3 text-[11px]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate font-mono" title={value ?? undefined}>
              {value ?? "–"}
            </dd>
          </div>
        ))}
      </dl>
      {vault.problem && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
        >
          {vault.problem}
        </p>
      )}
      {vault.ready &&
        (key ? (
          <div className="space-y-1.5">
            <div className="flex gap-1">
              <Input
                readOnly
                value={key}
                aria-label="Wiederherstellungsschlüssel"
                className="min-w-0 font-mono text-[11px]"
                onFocus={(event) => event.currentTarget.select()}
              />
              <VersioningIconButton
                icon={CopyIcon}
                label="Schlüssel kopieren"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(key)
                    .then(() =>
                      showCopiedMessage("Schlüssel kopiert. Zwischenablage danach leeren."),
                    )
                }
              />
              <VersioningIconButton
                icon={EyeOffIcon}
                label="Verbergen"
                onClick={() => setKey(null)}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              Wer diesen Schlüssel besitzt, kann alle Sicherungen dieses Tresors entschlüsseln. Nur
              in einem Passwortmanager oder Tresor des Unternehmens ablegen.
            </p>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setAsking(true)}
          >
            <KeyRoundIcon className="size-3.5" />
            Wiederherstellungsschlüssel anzeigen…
          </Button>
        ))}
      {(!vault.ready || vault.problem) && (
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!recovery.trim()) return;
            void workspace
              .run(() => branchingRecoveryImport(recovery.trim()), "Tresor entsperrt.")
              .then((ok) => ok && setRecovery(""));
          }}
        >
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">
              {vault.ready
                ? "Protokoll mit Wiederherstellungsschlüssel neu verankern"
                : "Wiederherstellungsschlüssel importieren"}
            </span>
            <Input
              type="password"
              value={recovery}
              autoComplete="off"
              onChange={(event) => setRecovery(event.target.value)}
              placeholder="l8dbvk1.…"
              className="font-mono text-[11px]"
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className="h-8 text-xs"
            disabled={!recovery.trim() || workspace.busy}
          >
            Importieren
          </Button>
        </form>
      )}
      {asking && (
        <NameConfirmDialog
          title="Wiederherstellungsschlüssel anzeigen?"
          description="Der Schlüssel entschlüsselt sämtliche Sicherungen dieses Tresors, auch auf anderen Rechnern. Der Abruf wird protokolliert."
          name=""
          requireName={false}
          action="Anzeigen"
          onClose={() => setAsking(false)}
          onConfirm={() => void workspace.run(async () => setKey(await branchingRecoveryKey()))}
        />
      )}
    </div>
  );
}
