import { toast } from "sonner";
import { create } from "zustand";
import { withTimeout } from "@/lib/async";
import { connectionError, isAuthFailure } from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";
import { closeSshTunnel, testConnectionString } from "@/lib/db";
import { ensurePassword } from "@/lib/password-prompt";
import { useSettingsStore } from "@/lib/settings";
import { getTransactionForConnection } from "@/lib/transactions";
import { effectiveConnectionString } from "./connection-string";
import { ensureSshTunnel, type TunnelOutcome } from "./tunnel";

interface ConnectionSwitchState {
  targetId: string | null;
  isSwitching: boolean;
  errorId: string | null;
}

export const useConnectionSwitch = create<ConnectionSwitchState>(() => ({
  targetId: null,
  isSwitching: false,
  errorId: null,
}));

async function performActivation(
  id: string | null,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  useConnectionSwitch.setState({ targetId: id, isSwitching: true, errorId: null });
  try {
    const store = useConnectionsStore.getState();
    const previous = store.connections.find((entry) => entry.id === store.activeId);
    const next = id ? store.connections.find((entry) => entry.id === id) : undefined;
    if (previous && previous.id !== id && getTransactionForConnection(previous.id)) {
      return {
        ok: false,
        error:
          "Schließe zuerst die offene Transaktion ab: Übernehmen oder Zurückrollen im Transaktionspanel.",
      };
    }
    if (id && !next) return { ok: false, error: "Verbindung nicht gefunden." };
    if (next?.ssh?.host) {
      const outcome = await ensureSshTunnel(next, sshPassword);
      if (!outcome.ok) return outcome;
    }
    if (next) {
      try {
        const current = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
        if (!current) return { ok: false, error: "Verbindung wurde entfernt." };
        await withTimeout(
          testConnectionString(current.kind, effectiveConnectionString(current)),
          (useSettingsStore.getState().connectionTimeout + 5) * 1000,
          "Verbindungstest hat nicht geantwortet (Timeout). Prüfe VPN und Host.",
        );
        if (
          useConnectionsStore.getState().connections.find((entry) => entry.id === id) !== current
        ) {
          return {
            ok: false,
            error: "Die Verbindung wurde während des Tests geändert. Bitte erneut verbinden.",
          };
        }
      } catch (error) {
        if (next.ssh?.host && previous?.id !== next.id) {
          await closeSshTunnel(next.id).catch(() => undefined);
          useConnectionsStore.setState((state) => ({
            connections: state.connections.map((entry) =>
              entry.id === next.id ? { ...entry, tunnelPort: null } : entry,
            ),
          }));
        }
        return { ok: false, error: connectionError(error) };
      }
    }
    if (previous?.tunnelPort && previous.id !== id) {
      try {
        await closeSshTunnel(previous.id);
      } catch {
        toast.warning("Der bisherige SSH-Tunnel konnte nicht geschlossen werden.");
      }
      useConnectionsStore.setState((state) => ({
        connections: state.connections.map((entry) =>
          entry.id === previous.id ? { ...entry, tunnelPort: null } : entry,
        ),
      }));
    }
    if (id !== store.activeId && typeof document !== "undefined") {
      const { router } = await import("@/router");
      const { pathname } = router.state.location;
      if (pathname !== "/" && !pathname.startsWith("/connections")) {
        await router.navigate({ to: "/", replace: true });
      }
    }
    store.setActiveId(id);
    return { ok: true };
  } finally {
    useConnectionSwitch.setState({ targetId: null, isSwitching: false });
  }
}

let activationQueue: Promise<unknown> = Promise.resolve();

export function activateConnection(
  id: string | null,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  const result = activationQueue.then(async () => {
    const outcome = await performActivation(id, sshPassword);
    if (!outcome.ok && id) {
      useConnectionSwitch.setState({ errorId: id });
    }
    return outcome;
  });
  activationQueue = result.catch(() => undefined);
  return result;
}

export async function activateConnectionWithToast(
  id: string | null,
  sshPassword?: string | null,
): Promise<boolean> {
  const target = id
    ? useConnectionsStore.getState().connections.find((entry) => entry.id === id)
    : null;
  const label = target?.name ?? "Verbindung";
  if (id && !(await ensurePassword(id))) {
    if (useConnectionsStore.getState().activeId === id) await activateConnection(null);
    return false;
  }
  const pending = id
    ? toast.loading(`Verbinde mit „${label}“…`)
    : toast.loading("Trenne Verbindung…");
  try {
    let outcome = await activateConnection(id, sshPassword);
    while (id && !outcome.ok && isAuthFailure(outcome.error)) {
      toast.dismiss(pending);
      if (
        !(await ensurePassword(
          id,
          `Anmeldung bei „${label}“ fehlgeschlagen (${outcome.error ?? "unbekannt"}). Passwort erneut eingeben.`,
        ))
      ) {
        if (useConnectionsStore.getState().activeId === id) await activateConnection(null);
        return false;
      }
      outcome = await activateConnection(id, sshPassword);
    }
    if (!outcome.ok) {
      toast.error(outcome.error ?? "Verbindung konnte nicht aktiviert werden.");
    } else if (id) {
      toast.success(`Mit „${label}“ verbunden`);
    } else {
      toast.success("Verbindung getrennt");
    }
    return outcome.ok;
  } catch (error) {
    toast.error(String(error));
    return false;
  } finally {
    toast.dismiss(pending);
  }
}

export async function restoreSshTunnel(): Promise<void> {
  const store = useConnectionsStore.getState();
  const active = store.connections.find((entry) => entry.id === store.activeId);
  if (!active?.ssh?.host) return;
  const outcome = await ensureSshTunnel(active);
  if (!outcome.ok) {
    toast.error(`SSH-Tunnel fehlgeschlagen: ${outcome.error ?? "Unbekannter Fehler"}`);
    await activateConnection(null);
  }
}
