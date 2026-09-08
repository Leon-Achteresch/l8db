export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Disposable { dispose(): void }
export type Permission = "database:read" | "database:write" | "network" | "filesystem:extension-storage" | "filesystem" | "clipboard:read" | "clipboard:write" | "process:execute";
export interface ConfigurationProperty {
  type: "boolean" | "string" | "number";
  default: boolean | string | number;
  description?: string;
  enum?: (boolean | string | number)[];
}
export type ViewLocation = "sidebar" | "panel";
export interface ViewContribution {
  id: string;
  title: string;
  location: ViewLocation;
  icon?: string;
}
export interface PanelContribution {
  id: string;
  title: string;
}
export interface StatusBarContribution {
  id: string;
  alignment?: "left" | "right";
  priority?: number;
}
export type MenuLocation = "palette" | "view/title" | "view/item" | "statusBar";
export interface MenuContribution {
  command: string;
  location: MenuLocation;
  view?: string;
  group?: string;
}
export interface NetworkCapabilities {
  hosts: string[];
}
export interface ProcessCapabilities {
  commands: string[];
}
export interface ExtensionCapabilities {
  network?: NetworkCapabilities;
  process?: ProcessCapabilities;
}
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  publisher: string;
  engines: { l8db: string; api: "^1.0.0" | "^1.1.0" };
  main: string;
  activationEvents: ("onStartup" | "onDatabaseOpen" | `onCommand:${string}` | `onView:${string}`)[];
  permissions?: Permission[];
  dependencies?: Record<string, string>;
  capabilities?: ExtensionCapabilities;
  contributes?: {
    commands?: { id: string; title: string; icon?: string }[];
    configuration?: Record<string, ConfigurationProperty>;
    views?: ViewContribution[];
    panels?: PanelContribution[];
    statusBar?: StatusBarContribution[];
    menus?: MenuContribution[];
  };
}
export interface ExtensionContext {
  extensionId: string;
  extensionPath: string;
  storagePath: string;
  subscriptions: Disposable[];
}
export interface DatabaseInfo { connectionId: string; name: string; kind: string }
export interface QueryResult {
  columns: string[];
  rows: Record<string, string | null>[];
  rowsAffected: number | null;
  executionTimeMs: number;
}
export interface ExtensionEvents {
  databaseOpened: DatabaseInfo;
  databaseClosed: DatabaseInfo;
  activeDatabaseChanged: DatabaseInfo | null;
  configurationChanged: { keys: string[] };
}
export interface TreeItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  badge?: string | number;
  collapsible?: boolean;
  expanded?: boolean;
  command?: string;
  commandArguments?: Json;
  children?: TreeItem[];
}
export interface StatusBarUpdate {
  text: string;
  tooltip?: string;
  command?: string;
  background?: "info" | "warning" | "error";
}
export interface ViewSnapshot {
  extensionId: string;
  viewId: string;
  title: string;
  location: ViewLocation;
  items: TreeItem[];
}
export interface StatusBarSnapshot {
  extensionId: string;
  itemId: string;
  alignment: "left" | "right";
  priority: number;
  update: StatusBarUpdate;
}
export interface PanelSnapshot {
  extensionId: string;
  panelId: string;
  title: string;
  html: string;
  open: boolean;
  updatedAt: number;
}
export type PromptKind = "quickPick" | "inputBox" | "message";
export interface PromptRequest {
  kind: PromptKind;
  extensionId: string;
  title?: string;
  message?: string;
  placeholder?: string;
  level?: "info" | "warning" | "error";
  password?: boolean;
  canPickMany?: boolean;
  defaultValue?: string;
  items?: QuickPickItem[];
  actions?: string[];
}
export type PromptResult<T extends PromptKind> = T extends "quickPick"
  ? number[] | undefined
  : T extends "inputBox"
    ? string | undefined
    : string | undefined;
export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}
export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
  canPickMany?: boolean;
}
export interface InputBoxOptions {
  title?: string;
  prompt?: string;
  placeholder?: string;
  value?: string;
  password?: boolean;
}
export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}
export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface ProcessOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}
export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export interface L8dbApi {
  readonly version: "1.1.0";
  commands: {
    registerCommand(id: string, handler: (payload?: Json) => Json | void | Promise<Json | void>): Disposable;
    executeCommand(id: string, payload?: Json): Promise<Json | void>;
    getCommands(): Promise<string[]>;
  };
  events: {
    onDatabaseOpened(listener: (event: DatabaseInfo) => void | Promise<void>): Disposable;
    onDatabaseClosed(listener: (event: DatabaseInfo) => void | Promise<void>): Disposable;
    onActiveDatabaseChanged(listener: (event: DatabaseInfo | null) => void | Promise<void>): Disposable;
  };
  notifications: {
    showInfo(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarning(message: string, ...actions: string[]): Promise<string | undefined>;
    showError(message: string, ...actions: string[]): Promise<string | undefined>;
  };
  configuration: {
    get<T extends boolean | string | number>(key: string): Promise<T>;
    onDidChange(listener: (event: { keys: string[] }) => void | Promise<void>): Disposable;
  };
  database: {
    getActive(): Promise<DatabaseInfo | null>;
    query(sql: string, params?: (string | null)[]): Promise<QueryResult>;
  };
  network: {
    fetch(url: string, options?: FetchOptions): Promise<FetchResponse>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  clipboard: {
    readText(): Promise<string>;
    writeText(value: string): Promise<void>;
  };
  workspace: {
    showOpenDialog(title?: string): Promise<string | null>;
    showSaveDialog(filename?: string): Promise<string | null>;
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, contents: string): Promise<void>;
  };
  process: {
    run(command: string, options?: ProcessOptions): Promise<ProcessResult>;
  };
  window: {
    showQuickPick(items: (string | QuickPickItem)[], options?: QuickPickOptions): Promise<(string | QuickPickItem)[] | undefined>;
    showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
    showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined>;
    showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined>;
  };
  views: {
    setTreeData(viewId: string, items: TreeItem[]): Promise<void>;
    reveal(viewId: string): Promise<void>;
  };
  statusBar: {
    set(itemId: string, update: StatusBarUpdate): Promise<void>;
    hide(itemId: string): Promise<void>;
  };
  panels: {
    open(panelId: string, html?: string): Promise<void>;
    close(panelId: string): Promise<void>;
    postMessage(panelId: string, message: Json): Promise<void>;
    onDidReceiveMessage(panelId: string, listener: (message: Json) => void | Promise<void>): Disposable;
  };
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
