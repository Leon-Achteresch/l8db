import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronDown, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { safeEndpoint } from "@/lib/ai/context";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import { type AiProfile, aiSetKey } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

import { AiMcpServerDialog } from "./ai-mcp-server-dialog";
import { AiUsageSettings } from "./ai-usage-settings";

interface Props {
  profile: AiProfile;
  cwd: string;
  setCwd: (cwd: string) => void;
  refresh: () => void;
  onError: (message: string) => void;
}
export function AiSettings({ profile, cwd, setCwd, refresh, onError }: Props) {
  const controlId = useId();
  const saveProfile = useAiStore((state) => state.saveProfile);
  const servers = useAiStore((state) => state.servers);
  const saveServer = useAiStore((state) => state.saveServer);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [endpoint, setEndpoint] = useState(profile.endpoint);
  const [saving, setSaving] = useState(false);
  const activeServers = servers.filter((server) => !server.deleted);
  const provider = AI_PROVIDERS.find((entry) => entry.id === profile.provider) ?? AI_PROVIDERS[0];
  const compatible = profile.provider === "compatible";
  const features = useNewFeatureVisibility<HTMLDivElement>("ai.providers");
  const mcpFeature = useNewFeatureVisibility<HTMLDivElement>("ai.context.mcp");
  const applyKey = async (value: string) => {
    setSaving(true);
    try {
      await aiSetKey(profile.id, value);
      setKey("");
      setSaved(Boolean(value));
      refresh();
    } catch (error) {
      onError(String(error));
    } finally {
      setSaving(false);
    }
  };
  const endpointField = (
    <label className="block space-y-1" htmlFor={`${controlId}-endpoint`}>
      <span>API-Endpoint</span>
      <Input
        id={`${controlId}-endpoint`}
        placeholder={compatible ? "https://api.example.com/v1" : "Standard-Endpoint"}
        value={endpoint}
        onChange={(event) => setEndpoint(event.target.value)}
        onBlur={() => {
          try {
            saveProfile({ ...profile, endpoint: safeEndpoint(endpoint) });
          } catch (error) {
            onError(String(error));
          }
        }}
      />
    </label>
  );
  return (
    <div className="space-y-5 overflow-auto p-4 text-xs">
      <div ref={features.ref} className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-medium">{provider.name}</h3>
            <p className="mt-1 text-muted-foreground">
              {provider.cli
                ? "Verwendet deinen lokalen CLI-Login sowie native Tools, Skills und MCP-Konfiguration."
                : "API-Schlüssel werden sicher im Betriebssystem-Schlüsselbund gespeichert."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Modelle & Fähigkeiten aktualisieren"
            title="Modelle & Fähigkeiten aktualisieren"
            onClick={refresh}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {provider.cli ? (
          <label className="block space-y-1" htmlFor={`${controlId}-binary`}>
            <span>CLI-Befehl oder Pfad</span>
            <Input
              id={`${controlId}-binary`}
              value={profile.binary}
              onChange={(event) => saveProfile({ ...profile, binary: event.target.value })}
            />
          </label>
        ) : (
          <label className="block space-y-1" htmlFor={`${controlId}-key`}>
            <span>API-Schlüssel{compatible ? " (optional)" : ""}</span>
            <div className="flex gap-2">
              <Input
                id={`${controlId}-key`}
                type="password"
                autoComplete="off"
                placeholder="Schlüssel eingeben"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setSaved(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && key) void applyKey(key);
                }}
              />
              <Button
                size="sm"
                aria-label="Schlüssel speichern"
                disabled={!key || saving}
                onClick={() => void applyKey(key)}
              >
                {saved ? <Check className="size-3" /> : null} Speichern
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Schlüssel entfernen"
                title="Schlüssel entfernen"
                disabled={saving}
                onClick={() => void applyKey("")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </label>
        )}
        {compatible && endpointField}
        <label className="block space-y-1" htmlFor={`${controlId}-cwd`}>
          <span>Arbeitsverzeichnis</span>
          <div className="flex gap-2">
            <Input
              id={`${controlId}-cwd`}
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Arbeitsverzeichnis auswählen"
              onClick={() =>
                void open({ directory: true, multiple: false })
                  .then((path) => {
                    if (typeof path === "string") setCwd(path);
                  })
                  .catch((error) => onError(String(error)))
              }
            >
              <FolderOpen className="size-4" />
            </Button>
          </div>
        </label>
      </div>
      <div ref={mcpFeature.ref} className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">MCP-Server</h3>
          <AiMcpServerDialog onError={onError} />
        </div>
        {activeServers.length ? (
          activeServers.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between gap-2 rounded-md border py-1 pr-1 pl-3"
            >
              <span className="truncate">
                {server.name}
                <span className="ml-2 text-muted-foreground">{server.transport}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${server.name} entfernen`}
                onClick={() => {
                  saveServer(server, true);
                  void aiSetKey(`mcp-${server.id}`, "").catch((error) => onError(String(error)));
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">
            Native Server bleiben verfügbar. Zusätzliche Server erscheinen im Kontext-Menü.
          </p>
        )}
      </div>
      <Collapsible className="border-t pt-4">
        <CollapsibleTrigger className="group flex w-full items-center justify-between font-medium">
          Erweitert
          <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <AiUsageSettings profile={profile} />
          {provider.cli && profile.provider !== "opencode" && (
            <label className="block space-y-1" htmlFor={`${controlId}-home`}>
              <span>Konfigurationsverzeichnis</span>
              <Input
                id={`${controlId}-home`}
                placeholder="Standardkonfiguration verwenden"
                value={profile.home}
                onChange={(event) => saveProfile({ ...profile, home: event.target.value })}
              />
            </label>
          )}
          {!provider.cli && !compatible && endpointField}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
