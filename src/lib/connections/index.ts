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
  SavedConnection,
  SshAuth,
  SshConnection,
} from "./types";
export {
  CONNECTION_COLORS,
  connectionColorLabel,
  sortConnectionsByName,
  TAG_COLORS,
  visibleSchemas,
} from "./types";
