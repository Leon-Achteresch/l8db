# SSH tunnels and proxies

All network indirection uses the same model: the backend opens a local listener on `127.0.0.1:<random port>` per connection id, the frontend stores that port as memory-only `tunnelPort`, and `effectiveConnectionString()` rewrites the database URL to it. A failing hop, agent or proxy aborts activation and the connection test with a German error that names the failing hop; there is never a direct-connect fallback.

## SSH authentication

- **Password / key**: unchanged. Key paths may start with `~/`.
- **Agent**: uses `SSH_AUTH_SOCK` or a custom socket path. Every identity (keys and certificates) is tried in order until the server accepts one. RSA keys use the best `rsa-sha2-*` variant the server offers.
  - 1Password: macOS `~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock`, Linux `~/.1password/agent.sock` (preset button in the editor).
  - Windows: default is the OpenSSH named pipe `\\.\pipe\openssh-ssh-agent` (also used by 1Password); a socket value of `pageant` uses Pageant.

## Jump hosts (ProxyJump)

`ssh.jumpHosts` is an ordered list. The first hop is reached via TCP (or the proxy), every further hop and finally the SSH server via `direct-tcpip` channels of the previous hop. Host keys are checked against known_hosts for every hop using the host name and port as seen from the previous hop; "Neue SSH-Host-Keys akzeptieren" (TOFU) applies to all hops.

## Proxies

`proxy` (`socks5` or `http`, optional user) is used to reach the first SSH hop. Without SSH, the backend forwards the local port through the proxy to the database host and port taken from the connection string (`open_proxy_tunnel`); opening the forwarder probes the proxy once so bad credentials or unreachable targets fail immediately. SOCKS5 sends host names to the proxy (remote DNS).

## Secrets

Secrets never enter localStorage. Keychain accounts per connection: `<id>` (database), `<id>:ssh` (password/passphrase), `<id>:ssh-jumps` (JSON array, one entry per jump host), `<id>:proxy` (proxy password). Exports contain hosts, users, key paths and agent sockets but no secrets.

## ~/.ssh/config import

"Aus ~/.ssh/config übernehmen" reads `Host` blocks (`HostName`, `User`, `Port`, `IdentityFile`, `IdentityAgent`, `ProxyJump`, `Host *` defaults). Aliases in `ProxyJump` are resolved against other blocks. `Include`, `Match` and wildcard host patterns are ignored.

## Limitations

- SSH host certificates are rejected (host keys only), as before.
- MCP server connections do not support SSH or proxies.
- The proxy forwarder needs a plain host and port in the connection string; URLs whose endpoint is resolved by the driver (e.g. DNS SRV records) cannot be forwarded.
- Windows agent support (named pipe, Pageant) uses russh's Windows agent API but is not covered by the Docker lab.
