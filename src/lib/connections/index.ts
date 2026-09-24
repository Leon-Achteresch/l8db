export {
  ConnectionScopeContext,
  useActiveConnection,
  useActiveConnectionId,
  useReadOnlyConnection,
} from "./hooks";
export { initConnectionSecrets, isReadOnlyConnection } from "./secrets";
export { createConnectionId, isMainWindow, useConnectionsStore, windowConnectionId } from "./store";
export type {
  ConnectionColor,
  ConnectionInput,
  ConnectionTag,
  NetworkProxy,
  ProxyType,
  SavedConnection,
  SshAuth,
  SshConnection,
  SshJumpHost,
} from "./types";
export {
  CONNECTION_COLORS,
  connectionColorLabel,
  sortConnectionsByName,
  TAG_COLORS,
  usesTunnel,
  visibleSchemas,
} from "./types";
