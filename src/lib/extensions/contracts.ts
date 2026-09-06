import type {
  DatabaseInfo,
  ExtensionArchive,
  ExtensionManifest,
  ExtensionState,
  Json,
  Permission,
} from "../../../packages/extension-api/src";

export type {
  DatabaseInfo,
  Disposable,
  ExtensionArchive,
  ExtensionManifest,
  ExtensionState,
  Json,
  Permission,
} from "../../../packages/extension-api/src";
export { ExtensionError } from "../../../packages/extension-api/src/manifest";
export interface InstalledExtension {
  archive: ExtensionArchive;
  enabled: boolean;
  grants: Permission[];
  configuration: Record<string, Json>;
  developmentPath?: string;
}
export interface ExtensionDescriptor extends InstalledExtension {
  state: ExtensionState;
  error?: string;
}
export interface ExtensionStorage {
  list(): Promise<InstalledExtension[]>;
  install(archive: ExtensionArchive, developmentPath?: string): Promise<void>;
  remove(id: string): Promise<void>;
  update(
    id: string,
    enabled: boolean,
    grants: Permission[],
    configuration: Record<string, Json>,
  ): Promise<void>;
  get(id: string, key: string): Promise<Json>;
  set(id: string, key: string, value: Json): Promise<void>;
}
export interface CoreServices {
  database(): DatabaseInfo | null;
  notify(message: string): void;
}
export type RpcHandler = (method: string, args: Json[]) => Promise<Json | void>;
export interface ExtensionRuntime {
  load(
    extension: ExtensionDescriptor,
    rpc: RpcHandler,
    onFailure: (error: Error) => void,
  ): Promise<void>;
  activate(extensionId: string): Promise<void>;
  deactivate(extensionId: string): Promise<void>;
  unload(extensionId: string): Promise<void>;
  execute(extensionId: string, command: string, payload?: Json): Promise<Json | void>;
  event(extensionId: string, name: string, payload: Json): void;
}
export interface RuntimeFactory {
  create(): ExtensionRuntime;
}
export interface ContributionHandler {
  validate(manifest: ExtensionManifest): void;
}
