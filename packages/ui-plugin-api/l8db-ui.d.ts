import type { JSX, ReactNode } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type Row = Readonly<Record<string, unknown>>;

export type Environment = "production" | "staging" | "test" | "development";

export interface ConnectionInfo {
  id: string;
  name: string;
  kind: string;
  environment: Environment | null;
  tags: readonly string[];
  readOnly: boolean;
}

export interface TableInfo {
  id: string;
  schema: string;
  name: string;
  database: string | null;
  kind: "table" | "view";
  connection: ConnectionInfo;
}

export interface ColumnInfo {
  id: string;
  type: string;
  label: string;
  primaryKey: boolean;
}

export interface ColumnPatch {
  id: string;
  hidden?: boolean;
  pinned?: boolean;
  order?: number;
  width?: number;
  label?: string;
  align?: "start" | "center" | "end";
}

export interface CellProps {
  value: unknown;
  row: Row;
  column: ColumnInfo;
  table: TableInfo;
  rowIndex: number;
  rows: readonly Row[];
  options: OptionValues;
}

export interface HttpInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface ActionContext {
  table: TableInfo;
  columns: readonly ColumnInfo[];
  selection: readonly Row[];
  rows: readonly Row[];
  options: OptionValues;
  toast(text: string, tone?: Tone): void;
  http(url: string, init?: HttpInit): Promise<HttpResponse>;
  copy(text: string): Promise<void>;
  openTable(table: string): void;
  refresh(): void;
}

export interface ToolbarAction {
  id: string;
  label: string;
  tone?: Tone;
  run(ctx: ActionContext): void | Promise<void>;
}

export interface DetailTabProps {
  rows: readonly Row[];
  columns: readonly ColumnInfo[];
  table: TableInfo;
  selection: readonly Row[];
  options: OptionValues;
  toast(text: string, tone?: Tone): void;
  http(url: string, init?: HttpInit): Promise<HttpResponse>;
  openTable(table: string): void;
}

export interface DetailTab {
  id: string;
  label: string;
  render(props: DetailTabProps): ReactNode;
}

export interface TabInfo {
  key: string;
  kind: "table" | "view" | "query" | "other";
  title: string;
  connection: ConnectionInfo | null;
  table: TableInfo | null;
}

export interface TabGroup {
  id: string;
  label: string;
  tone?: Tone;
}

export interface TabItemProps {
  tab: TabInfo;
  active: boolean;
  Default: () => JSX.Element;
}

export interface TabsOptions {
  closeButton?: "auto" | "always" | "hover" | "never";
  newTabPosition?: "end" | "afterActive";
}

export type SplitLayout = "columns" | "rows" | "leftStack" | "topStack" | "grid";

export interface SplitOptions {
  autoSaveGroups?: boolean;
}

export interface TemplatePane {
  table: string;
  master?: number;
  link?: { column: string; masterColumn?: string };
}

export interface Template {
  id: string;
  name: string;
  when?: {
    connectionTag?: string | readonly string[];
    connectionName?: string | readonly string[];
  };
  orientation?: "horizontal" | "vertical";
  panes: readonly TemplatePane[];
}

export interface Slots {
  grid?: {
    columns?(table: TableInfo, columns: readonly ColumnInfo[]): readonly ColumnPatch[] | undefined;
    cell?(props: CellProps): ReactNode | undefined;
    rowTone?(row: Row, table: TableInfo): Tone | undefined;
  };
  table?: {
    toolbar?(table: TableInfo): readonly ToolbarAction[] | undefined;
    detailTabs?(table: TableInfo): readonly DetailTab[] | undefined;
  };
  tabs?: {
    group?(tab: TabInfo): TabGroup | undefined;
    item?(props: TabItemProps): ReactNode | undefined;
    options?: TabsOptions;
  };
  split?: {
    layout?(count: number, orientation: "horizontal" | "vertical"): SplitLayout | undefined;
    options?: SplitOptions;
    templates?: readonly Template[];
  };
}

export type OptionSpec =
  | { type: "boolean"; label: string; description?: string; default?: boolean }
  | { type: "text"; label: string; description?: string; default?: string; placeholder?: string }
  | {
      type: "number";
      label: string;
      description?: string;
      default?: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      type: "select";
      label: string;
      description?: string;
      default?: string;
      choices: readonly (string | { value: string; label: string })[];
    };

export type OptionValues = Readonly<Record<string, string | number | boolean>>;

export interface Plugin {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  permissions?: { http?: readonly string[] };
  options?: Readonly<Record<string, OptionSpec>>;
  slots: Slots | ((options: OptionValues) => Slots);
}

export declare function definePlugin<P extends Plugin>(plugin: P): P;

export declare function Pill(props: { tone?: Tone; children?: ReactNode }): JSX.Element;
export declare function Badge(props: { tone?: Tone; children?: ReactNode }): JSX.Element;
export declare function Check(props: { checked: boolean; label?: string }): JSX.Element;
export declare function RelativeTime(props: { value: unknown }): JSX.Element;
export declare function Text(props: {
  tone?: Tone | "muted";
  weight?: "normal" | "medium" | "bold";
  size?: "xs" | "sm" | "md";
  mono?: boolean;
  truncate?: boolean;
  children?: ReactNode;
}): JSX.Element;
export declare function Stack(props: {
  direction?: "row" | "column";
  gap?: 0 | 1 | 2 | 3 | 4;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  children?: ReactNode;
}): JSX.Element;
export declare function Button(props: {
  onClick?: () => void;
  tone?: Tone;
  variant?: "solid" | "outline" | "ghost";
  disabled?: boolean;
  children?: ReactNode;
}): JSX.Element;
export declare function Card(props: {
  title?: ReactNode;
  tone?: Tone;
  children?: ReactNode;
}): JSX.Element;
export declare function Columns(props: {
  gap?: 0 | 1 | 2 | 3 | 4;
  children?: ReactNode;
}): JSX.Element;
export declare function Bar(props: {
  value: number;
  max: number;
  tone?: Tone;
  label?: ReactNode;
}): JSX.Element;
export declare function List<T>(props: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
  limit?: number;
  empty?: ReactNode;
}): JSX.Element;
export declare function Board<T>(props: {
  columns: readonly { id: string; label: string; tone?: Tone; items: readonly T[] }[];
  render: (item: T) => ReactNode;
  limit?: number;
}): JSX.Element;
export declare function Empty(props: { children?: ReactNode }): JSX.Element;

export declare function asText(value: unknown): string;
export declare function asNumber(value: unknown): number | null;
export declare function asDate(value: unknown): Date | null;
export declare function daysFromToday(value: unknown): number | null;
export declare function formatNumber(
  value: unknown,
  options?: { decimals?: number; currency?: string },
): string;
export declare function formatDate(value: unknown, options?: { time?: boolean }): string;
