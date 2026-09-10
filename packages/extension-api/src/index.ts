export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Disposable { dispose(): void }
export type Permission = "database:read" | "database:write" | "network" | "filesystem:extension-storage" | "filesystem" | "clipboard:read" | "clipboard:write" | "process:execute";
export interface ConfigurationProperty {
  type: "boolean" | "string" | "number";
  default: boolean | string | number;
  description?: string;
}
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  publisher: string;
  engines: { l8db: string; api: "^1.0.0" };
  main: string;
  activationEvents: ("onStartup" | "onDatabaseOpen" | `onCommand:${string}`)[];
  permissions?: Permission[];
  dependencies?: Record<string, string>;
  contributes?: {
    commands?: { id: string; title: string }[];
    configuration?: Record<string, ConfigurationProperty>;
  };
}
export interface ExtensionContext {
  extensionId: string;
  extensionPath: string;
  storagePath: string;
  subscriptions: Disposable[];
}
export interface DatabaseInfo { connectionId: string; name: string; kind: string }
export interface ExtensionEvents { databaseOpened: DatabaseInfo; databaseClosed: DatabaseInfo }
export interface L8dbApi {
  readonly version: "1.0.0";
  commands: {
    registerCommand(id: string, handler: (payload?: Json) => Json | void | Promise<Json | void>): Disposable;
    executeCommand(id: string, payload?: Json): Promise<Json | void>;
  };
  events: {
    onDatabaseOpened(listener: (event: DatabaseInfo) => void | Promise<void>): Disposable;
    onDatabaseClosed(listener: (event: DatabaseInfo) => void | Promise<void>): Disposable;
  };
  notifications: { showInfo(message: string): Promise<void> };
  configuration: { get<T extends boolean | string | number>(key: string): Promise<T> };
  database: { getActive(): Promise<DatabaseInfo | null> };
  assets: { readText(path: string): Promise<string> };
  storage: { get(key: string): Promise<Json>; set(key: string, value: Json): Promise<void> };
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
}
export interface ExtensionModule {
  activate(context: ExtensionContext, api: L8dbApi): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
export type ExtensionState = "discovered" | "validated" | "loaded" | "activated" | "deactivated" | "failed";
export interface ExtensionArchive { format: 1; manifest: ExtensionManifest; files: Record<string, string> }
export interface ExtensionPackage { id: string; version: string; manifest: ExtensionManifest }
export interface ExtensionRegistryProvider {
  search(query: string): Promise<ExtensionPackage[]>;
  get(extensionId: string): Promise<ExtensionPackage | null>;
  download(extensionId: string, version: string): Promise<ExtensionArchive>;
}
