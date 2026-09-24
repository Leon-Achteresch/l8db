import { useEffect, useState } from "react";
import type { ProxyType, SavedConnection, SshAuth, SshJumpHost } from "@/lib/connections";
import { loadSecret } from "@/lib/secrets";
import { parseJumpSecrets, sshJumpSecretAccount } from "@/lib/ssh";

export interface JumpHostDraft {
  key: string;
  host: string;
  port: string;
  user: string;
  auth: SshAuth;
  keyFile: string;
  agentSocket: string;
  secret: string;
}

export function jumpHostDraft(jump?: Partial<SshJumpHost>): JumpHostDraft {
  return {
    key: crypto.randomUUID(),
    host: jump?.host ?? "",
    port: String(jump?.port ?? 22),
    user: jump?.user ?? "",
    auth: jump?.auth ?? "agent",
    keyFile: jump?.keyFile ?? "",
    agentSocket: jump?.agentSocket ?? "",
    secret: "",
  };
}

export function useNetworkDraft(seed: SavedConnection | undefined, connectionId?: string) {
  const [sshAgentSocket, setSshAgentSocket] = useState(seed?.ssh?.agentSocket ?? "");
  const [jumpHosts, setJumpHosts] = useState<JumpHostDraft[]>(() =>
    (seed?.ssh?.jumpHosts ?? []).map(jumpHostDraft),
  );
  const [proxyEnabled, setProxyEnabled] = useState(Boolean(seed?.proxy?.host));
  const [proxyType, setProxyType] = useState<ProxyType>(seed?.proxy?.type ?? "socks5");
  const [proxyHost, setProxyHost] = useState(seed?.proxy?.host ?? "");
  const [proxyPort, setProxyPort] = useState(String(seed?.proxy?.port ?? 1080));
  const [proxyUser, setProxyUser] = useState(seed?.proxy?.username ?? "");
  const [proxyPassword, setProxyPassword] = useState("");

  useEffect(() => {
    if (!connectionId) return;
    void loadSecret(sshJumpSecretAccount(connectionId))
      .then((raw) => {
        const secrets = parseJumpSecrets(raw);
        if (!secrets.length) return;
        setJumpHosts((current) =>
          current.map((jump, index) => ({ ...jump, secret: jump.secret || secrets[index] || "" })),
        );
      })
      .catch(() => undefined);
  }, [connectionId]);

  const addJumpHost = () => setJumpHosts((current) => [...current, jumpHostDraft()]);
  const updateJumpHost = (key: string, patch: Partial<JumpHostDraft>) =>
    setJumpHosts((current) =>
      current.map((jump) => (jump.key === key ? { ...jump, ...patch } : jump)),
    );
  const removeJumpHost = (key: string) =>
    setJumpHosts((current) => current.filter((jump) => jump.key !== key));
  const moveJumpHost = (key: string, delta: number) =>
    setJumpHosts((current) => {
      const index = current.findIndex((jump) => jump.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return {
    sshAgentSocket,
    setSshAgentSocket,
    jumpHosts,
    setJumpHosts,
    addJumpHost,
    updateJumpHost,
    removeJumpHost,
    moveJumpHost,
    proxyEnabled,
    setProxyEnabled,
    proxyType,
    setProxyType,
    proxyHost,
    setProxyHost,
    proxyPort,
    setProxyPort,
    proxyUser,
    setProxyUser,
    proxyPassword,
    setProxyPassword,
  };
}

export type NetworkDraft = ReturnType<typeof useNetworkDraft>;
