export type SshAuthRequest = { password: string } | { key_file: string; passphrase?: string };

export interface SshTunnelRequest {
  id: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuthRequest;
  remote_host: string;
  remote_port: number;
  accept_new_host_key: boolean;
}

export interface SshTunnelInfo {
  id: string;
  local_port: number;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  remote_host: string;
  remote_port: number;
}
