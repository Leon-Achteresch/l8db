import type {
  DatabaseInfo,
  ExtensionArchive,
  ExtensionManifest,
  ExtensionState,
  FetchOptions,
  FetchResponse,
  Json,
  Permission,
  ProcessOptions,
  ProcessResult,
  PromptKind,
  PromptRequest,
  PromptResult,
  QueryResult,
} from "../../../packages/extension-api/src";

export type {
  DatabaseInfo,
  Disposable,
  ExtensionArchive,
  ExtensionManifest,
  ExtensionState,
  FetchOptions,
  FetchResponse,
  InputBoxOptions,
  Json,
  MenuContribution,
  PanelContribution,
  PanelSnapshot,
  Permission,
  ProcessOptions,
  ProcessResult,
  PromptKind,
  PromptRequest,
  PromptResult,
  QueryResult,
  QuickPickItem,
  QuickPickOptions,
  StatusBarContribution,
  StatusBarSnapshot,
  StatusBarUpdate,
  TreeItem,
  ViewContribution,
  ViewLocation,
  ViewSnapshot,
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
  replace(id: string, archive: ExtensionArchive, developmentPath?: string): Promise<void>;
  remove(id: string): Promise<void>;
  update(
    id: string,
    enabled: boolean,
    grants: Permission[],
    configuration: Record<string, Json>,
  ): Promise<void>;
  get(id: string, key: string): Promise<Json>;
  set(id: string, key: string, value: Json): Promise<void>;
  secretGet(id: string, key: string): Promise<string | null>;
  secretSet(id: string, key: string, value: string): Promise<void>;
  secretDelete(id: string, key: string): Promise<void>;
}
export interface QueryRequest {
  sql: string;
  params?: (string | null)[];
  write: boolean;
}
export interface CoreServices {
  database(): DatabaseInfo | null;
  notify(message: string): void;
  query(request: QueryRequest): Promise<QueryResult>;
  fetch(request: { url: string; options: FetchOptions }): Promise<FetchResponse>;
  clipboardRead(): Promise<string>;
  clipboardWrite(value: string): Promise<void>;
  showOpenDialog(title?: string): Promise<string | null>;
  showSaveDialog(filename?: string): Promise<string | null>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  runProcess(request: { command: string; options: ProcessOptions }): Promise<ProcessResult>;
  prompt<T extends PromptKind>(request: PromptRequest & { kind: T }): Promise<PromptResult<T>>;
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
