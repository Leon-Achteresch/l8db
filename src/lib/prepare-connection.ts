import { type SavedConnection, useConnectionsStore, usesTunnel } from "@/lib/connections";
import { ensurePassword } from "@/lib/password-prompt";
import { ensureSshTunnel } from "@/lib/ssh";

export async function prepareConnection(id: string): Promise<SavedConnection> {
  const find = () => useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!find()) throw new Error("Die Verbindung existiert nicht mehr.");
  if (!(await ensurePassword(id))) throw new Error("Ohne Passwort kann nicht verbunden werden.");
  const fresh = find();
  if (usesTunnel(fresh) && !fresh.tunnelPort) {
    const outcome = await ensureSshTunnel(fresh);
    if (!outcome.ok) throw new Error(outcome.error ?? "SSH-Tunnel konnte nicht geöffnet werden.");
  }
  const ready = find();
  if (!ready) throw new Error("Die Verbindung existiert nicht mehr.");
  return ready;
}
