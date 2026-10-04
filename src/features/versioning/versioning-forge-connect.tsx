import { useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FORGE_LABELS,
  type ForgeInfo,
  type ForgeKind,
  forge,
  openForgeUrl,
} from "@/lib/versioning/forge";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningSelect } from "./versioning-select";

const SCOPES: Record<ForgeKind, string> = {
  github:
    "Classic Token mit „repo“ oder Fine-grained Token mit Lesezugriff auf Inhalte und Schreibzugriff auf Pull Requests.",
  gitlab: "Persönlicher Zugangstoken mit dem Bereich „api“.",
  azure: "Persönlicher Zugangstoken mit „Code: Read & write“.",
  gitea:
    "Zugangstoken mit Lese- und Schreibrechten für Repositorys und Lesezugriff auf den Benutzer.",
};

export function VersioningForgeConnect({
  workspace,
  info,
}: {
  workspace: VersioningWorkspace;
  info: ForgeInfo;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState("");
  const [token, setToken] = useState("");
  if (!info.remote) return null;
  const selected = info.remote.kind ?? ((kind || null) as ForgeKind | null);
  const connect = async () => {
    if (!selected) throw new Error("Git-Plattform auswählen.");
    await forge(workspace.repo, "connect", { kind: selected, token });
    setToken("");
    await queryClient.invalidateQueries({ queryKey: ["versioning-forge", workspace.repo] });
  };
  return (
    <form
      className="space-y-3 rounded-xl bg-muted/35 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void workspace.run(connect, "Git-Plattform verbunden");
      }}
    >
      <div>
        <h3 className="text-xs font-semibold">
          Mit {selected ? FORGE_LABELS[selected] : "der Git-Plattform"} verbinden
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Pull Requests, Reviews und Merges laufen über {info.remote.host}. Der Token liegt nur im
          Schlüsselbund dieses Rechners und wird ausschließlich an diesen Host gesendet.
        </p>
      </div>
      {!info.remote.kind && (
        <VersioningSelect
          label="Git-Plattform"
          value={kind}
          onChange={setKind}
          placeholder="Plattform auswählen"
          options={(["github", "gitlab", "gitea"] as const).map((value) => ({
            value,
            label: `${FORGE_LABELS[value]} (selbst betrieben)`,
          }))}
        />
      )}
      <label htmlFor="vcs-forge-token" className="block space-y-1.5 text-xs font-medium">
        Zugangstoken
        <Input
          id="vcs-forge-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="font-mono text-[11px]"
        />
      </label>
      {selected && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{SCOPES[selected]}</p>
      )}
      {info.problem && (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">
          {info.problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!token.trim() || !selected}>
          <KeyRoundIcon className="size-3.5" />
          Verbinden
        </Button>
        {info.tokenUrl && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void workspace.run(() => openForgeUrl(info.tokenUrl ?? ""))}
          >
            <ExternalLinkIcon className="size-3.5" />
            Token erstellen
          </Button>
        )}
      </div>
    </form>
  );
}
