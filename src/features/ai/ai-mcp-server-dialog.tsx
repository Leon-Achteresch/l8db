import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { safeEndpoint } from "@/lib/ai/context";
import { useAiStore } from "@/lib/ai/store";
import { type AiServer, aiSetKey } from "@/lib/db/ai";

const emptyServer = (): AiServer => ({
  id: crypto.randomUUID(),
  name: "",
  transport: "http",
  command: "",
  args: [],
  url: "",
});

export function AiMcpServerDialog({ onError }: { onError: (message: string) => void }) {
  const id = useId();
  const saveServer = useAiStore((state) => state.saveServer);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AiServer>(emptyServer);
  const [args, setArgs] = useState("");
  const [bearer, setBearer] = useState("");
  const [saving, setSaving] = useState(false);
  const reset = () => {
    setDraft(emptyServer());
    setArgs("");
    setBearer("");
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
      reset();
      setOpen(false);
    } catch (error) {
      onError(String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3" /> Server hinzufügen
        </Button>
      </DialogTrigger>
      <DialogContent className="text-xs">
        <DialogHeader>
          <DialogTitle>MCP-Server hinzufügen</DialogTitle>
          <DialogDescription>
            Zusätzliche Server stehen danach im Kontext-Menü zur Auswahl.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`${id}-form`}
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void addServer();
          }}
        >
          <label className="block space-y-1" htmlFor={`${id}-name`}>
            <span>Name</span>
            <Input
              id={`${id}-name`}
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            aria-label="Transport"
            value={draft.transport}
            onValueChange={(value) =>
              value && setDraft({ ...draft, transport: value as AiServer["transport"] })
            }
          >
            <ToggleGroupItem value="http" className="h-7 px-3 text-xs">
              HTTP
            </ToggleGroupItem>
            <ToggleGroupItem value="stdio" className="h-7 px-3 text-xs">
              stdio
            </ToggleGroupItem>
          </ToggleGroup>
          {draft.transport === "http" ? (
            <>
              <label className="block space-y-1" htmlFor={`${id}-url`}>
                <span>Server-URL</span>
                <Input
                  id={`${id}-url`}
                  placeholder="https://example.com/mcp"
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </label>
              <label className="block space-y-1" htmlFor={`${id}-bearer`}>
                <span>Bearer-Token (optional)</span>
                <Input
                  id={`${id}-bearer`}
                  type="password"
                  autoComplete="off"
                  value={bearer}
                  onChange={(event) => setBearer(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label className="block space-y-1" htmlFor={`${id}-command`}>
                <span>Befehl</span>
                <Input
                  id={`${id}-command`}
                  placeholder="npx"
                  value={draft.command}
                  onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                />
              </label>
              <label className="block space-y-1" htmlFor={`${id}-args`}>
                <span>Argumente (JSON)</span>
                <Input
                  id={`${id}-args`}
                  placeholder={'["-y", "my-mcp-server"]'}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                />
              </label>
            </>
          )}
        </form>
        <DialogFooter>
          <Button size="sm" type="submit" form={`${id}-form`} disabled={saving}>
            Hinzufügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
