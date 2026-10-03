import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeEndpoint } from "@/lib/ai/context";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import { type AiProfile, type AiServer, aiSetKey } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

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
  const [draft, setDraft] = useState<AiServer>({
    id: crypto.randomUUID(),
    name: "",
    transport: "http",
    command: "",
    args: [],
    url: "",
  });
  const [args, setArgs] = useState("");
  const [bearer, setBearer] = useState("");
  const [saving, setSaving] = useState(false);
  const provider = AI_PROVIDERS.find((entry) => entry.id === profile.provider) ?? AI_PROVIDERS[0];
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
  const addServer = async () => {
    setSaving(true);
    try {
      if (!draft.name.trim()) throw new Error("Name für den MCP-Server eingeben.");
      let server = { ...draft, name: draft.name.trim() };
      if (draft.transport === "http") server = { ...server, url: safeEndpoint(draft.url) };
      else {
        if (!draft.command.trim()) throw new Error("MCP-Befehl eingeben.");
        const parsed: unknown = JSON.parse(args || "[]");
        if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string"))
          throw new Error("Argumente als JSON-Liste von Texten eingeben.");
        server = { ...server, args: parsed };
      }
      if (bearer) await aiSetKey(`mcp-${server.id}`, bearer);
      saveServer(server);
      setBearer("");
      setArgs("");
      setDraft({
        id: crypto.randomUUID(),
        name: "",
        transport: "http",
        command: "",
        args: [],
        url: "",
      });
    } catch (error) {
      onError(String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5 overflow-auto p-4 text-xs">
      <div ref={features.ref} className="space-y-3">
        <div>
          <h3 className="font-medium">{provider.name}</h3>
          <p className="mt-1 text-muted-foreground">
            {provider.cli
              ? "Verwendet deinen lokalen CLI-Login sowie native Tools, Skills und MCP-Konfiguration."
              : "API-Schlüssel werden sicher im Betriebssystem-Schlüsselbund gespeichert."}
          </p>
        </div>
        {provider.cli ? (
          <>
            <label className="block space-y-1" htmlFor={`${controlId}-1`}>
              <span>CLI-Befehl oder Pfad</span>
              <Input
                id={`${controlId}-1`}
                value={profile.binary}
                onChange={(event) => saveProfile({ ...profile, binary: event.target.value })}
              />
            </label>
            {profile.provider !== "opencode" && (
              <label className="block space-y-1" htmlFor={`${controlId}-2`}>
                <span>Konfigurationsverzeichnis (optional)</span>
                <Input
                  id={`${controlId}-2`}
                  placeholder="Standardkonfiguration verwenden"
                  value={profile.home}
                  onChange={(event) => saveProfile({ ...profile, home: event.target.value })}
                />
              </label>
            )}
          </>
        ) : (
          <>
            <label className="block space-y-1" htmlFor={`${controlId}-3`}>
              <span>API-Schlüssel{profile.provider === "compatible" ? " (optional)" : ""}</span>
              <Input
                id={`${controlId}-3`}
                type="password"
                autoComplete="off"
                placeholder="Schlüssel eingeben"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <div className="flex gap-2">
              <Button size="sm" disabled={!key || saving} onClick={() => void applyKey(key)}>
                {saved ? <Check className="size-3" /> : null} Schlüssel speichern
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void applyKey("")}>
                Schlüssel entfernen
              </Button>
            </div>
            <label className="block space-y-1" htmlFor={`${controlId}-4`}>
              <span>API-Endpoint{profile.provider === "compatible" ? "" : " (optional)"}</span>
              <Input
                id={`${controlId}-4`}
                placeholder={
                  profile.provider === "compatible"
                    ? "https://api.example.com/v1"
                    : "Standard-Endpoint"
                }
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
          </>
        )}
        <label className="block space-y-1" htmlFor={`${controlId}-5`}>
          <span>Arbeitsverzeichnis</span>
          <div className="flex gap-2">
            <Input
              id={`${controlId}-5`}
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
        <Button size="sm" variant="outline" onClick={refresh}>
          Modelle &amp; Fähigkeiten aktualisieren
        </Button>
      </div>
      <AiUsageSettings profile={profile} />
      <div ref={mcpFeature.ref} className="space-y-3 border-t pt-4">
        <h3 className="font-medium">Zusätzliche MCP-Server</h3>
        <p className="text-muted-foreground">
          Native Server bleiben verfügbar. Zusätzliche Server im Kontext-Menü auswählen.
        </p>
        {servers
          .filter((server) => !server.deleted)
          .map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <span>
                {server.name}
                <span className="ml-2 text-muted-foreground">{server.transport}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${server.name} entfernen`}
                onClick={() => {
                  saveServer(server, true);
                  void aiSetKey(`mcp-${server.id}`, "").catch((error) => onError(String(error)));
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        <label className="block space-y-1" htmlFor={`${controlId}-6`}>
          <span>Name</span>
          <Input
            id={`${controlId}-6`}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span>Transport</span>
          <select
            className="h-8 rounded-md border bg-background px-2"
            value={draft.transport}
            onChange={(event) =>
              setDraft({ ...draft, transport: event.target.value as "http" | "stdio" })
            }
          >
            <option value="http">HTTP</option>
            <option value="stdio">stdio</option>
          </select>
        </label>
        {draft.transport === "http" ? (
          <>
            <label className="block space-y-1" htmlFor={`${controlId}-8`}>
              <span>Server-URL</span>
              <Input
                id={`${controlId}-8`}
                placeholder="https://example.com/mcp"
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
            </label>
            <label className="block space-y-1" htmlFor={`${controlId}-9`}>
              <span>Bearer-Token (optional)</span>
              <Input
                id={`${controlId}-9`}
                type="password"
                autoComplete="off"
                value={bearer}
                onChange={(event) => setBearer(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="block space-y-1" htmlFor={`${controlId}-10`}>
              <span>Befehl</span>
              <Input
                id={`${controlId}-10`}
                placeholder="npx"
                value={draft.command}
                onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              />
            </label>
            <label className="block space-y-1" htmlFor={`${controlId}-11`}>
              <span>Argumente (JSON)</span>
              <Input
                id={`${controlId}-11`}
                placeholder={'["-y", "my-mcp-server"]'}
                value={args}
                onChange={(event) => setArgs(event.target.value)}
              />
            </label>
          </>
        )}
        <Button size="sm" variant="outline" disabled={saving} onClick={() => void addServer()}>
          <Plus className="size-3" /> Server hinzufügen
        </Button>
      </div>
    </div>
  );
}
