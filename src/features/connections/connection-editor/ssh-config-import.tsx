import { FileInput } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listSshConfigHosts,
  type SshConfigDraft,
  type SshConfigHost,
  sshConfigDraft,
} from "@/lib/ssh";

export function SshConfigImport({ onApply }: { onApply: (draft: SshConfigDraft) => void }) {
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const entries = await listSshConfigHosts();
      setHosts(entries);
      if (!entries.length) setError("In ~/.ssh/config wurden keine Host-Einträge gefunden.");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  function apply(alias: string) {
    const entry = hosts?.find((host) => host.alias === alias);
    if (entry) onApply(sshConfigDraft(entry));
  }

  return (
    <div className="grid gap-1.5">
      {hosts?.length ? (
        <Select onValueChange={apply}>
          <SelectTrigger aria-label="Host aus ~/.ssh/config" className="w-full">
            <SelectValue placeholder="Host aus ~/.ssh/config wählen" />
          </SelectTrigger>
          <SelectContent position="popper">
            {hosts.map((host) => (
              <SelectItem key={host.alias} value={host.alias}>
                {host.alias}
                {host.host_name && host.host_name !== host.alias ? ` · ${host.host_name}` : ""}
                {host.proxy_jump.length ? ` · über ${host.proxy_jump.length} Sprung-Host(s)` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 justify-self-start"
          disabled={loading}
          onClick={() => void load()}
        >
          <FileInput className="size-3.5" />
          {loading ? "Lese ~/.ssh/config…" : "Aus ~/.ssh/config übernehmen"}
        </Button>
      )}
      {error && <p className="text-[11px] text-muted-foreground">{error}</p>}
    </div>
  );
}
