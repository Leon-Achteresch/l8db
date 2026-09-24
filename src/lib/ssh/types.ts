export type SshAuthRequest =
  | { method: "password"; password: string }
  | { method: "key"; key_file: string; passphrase?: string }
  | { method: "agent"; agent_socket?: string };

export interface SshHopRequest {
  host: string;
  port: number;
  user: string;
  auth: SshAuthRequest;
}

export interface ProxyRequest {
  kind: "socks5" | "http";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface SshTunnelRequest {
  id: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuthRequest;
  jump_hosts: SshHopRequest[];
  proxy: ProxyRequest | null;
  remote_host: string;
  remote_port: number;
  accept_new_host_key: boolean;
}

export interface ProxyTunnelRequest {
  id: string;
  proxy: ProxyRequest;
  remote_host: string;
  remote_port: number;
}

export interface SshTunnelInfo {
  id: string;
  kind: "ssh" | "proxy";
  local_port: number;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  jump_hosts: string[];
  proxy: string | null;
  remote_host: string;
  remote_port: number;
}

export interface SshConfigJump {
  host: string;
  port: number | null;
  user: string | null;
  identity_file: string | null;
  identity_agent: string | null;
}

export interface SshConfigHost {
  alias: string;
  host_name: string | null;
  user: string | null;
  port: number | null;
  identity_file: string | null;
  identity_agent: string | null;
  proxy_jump: SshConfigJump[];
}
