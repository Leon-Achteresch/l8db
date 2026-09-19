import type { ExtensionEvents } from "../../../../packages/extension-api/src";
import type {
  CoreServices,
  Disposable,
  ExtensionDescriptor,
  ExtensionRuntime,
  ExtensionStorage,
  Json,
} from "../contracts";
import type {
  CommandRegistry,
  ConfigurationRegistry,
  EventBus,
  ExtensionRegistry,
  PanelRegistry,
  PermissionManager,
  StatusBarRegistry,
  ViewRegistry,
} from "../registries";

export type RpcContext = {
  extension: ExtensionDescriptor;
  id: string;
  method: string;
  args: Json[];
  text: (index: number, max?: number) => string;
  optionalText: (index: number, max?: number) => string | undefined;
  resources: Map<string, Disposable>;
  runtime: ExtensionRuntime;
  core: CoreServices;
  storage: ExtensionStorage;
  registry: ExtensionRegistry;
  commands: CommandRegistry;
  configuration: ConfigurationRegistry;
  permissions: PermissionManager;
  views: ViewRegistry;
  statusBar: StatusBarRegistry;
  panels: PanelRegistry;
  events: EventBus<ExtensionEvents>;
  changed: () => void;
  trigger: (event: `onView:${string}`) => Promise<void>;
  log: (id: string, level: string, message: string) => void;
  allowFs: (id: string, path: string) => void;
  requireFs: (id: string, path: string) => void;
};

export type RpcHandler = (ctx: RpcContext) => Promise<Json | void>;

export type RpcDeps = Omit<
  RpcContext,
  "extension" | "id" | "method" | "args" | "text" | "optionalText" | "resources"
>;
