import { invoke } from "./core";

export type ConvexUdfType = "query" | "mutation" | "action" | "httpAction" | "unknown";

export interface ConvexStudioComponent {
  id: string;
  name: string | null;
  path: string;
  state: string;
  httpPrefix: string | null;
  args: unknown;
}

export interface ConvexStudioFunction {
  name: string;
  identifier: string;
  udfType: ConvexUdfType;
  visibility: "public" | "internal" | string;
  lineno: number | null;
  args: unknown | null;
  returns: unknown | null;
}

export interface ConvexStudioModule {
  path: string;
  componentId: string | null;
  componentPath: string;
  functions: ConvexStudioFunction[];
}

export interface ConvexStudioHttpRoute {
  method: string;
  path: string;
  componentPath: string;
}

export interface ConvexStudioFunctionCatalog {
  components: ConvexStudioComponent[];
  modules: ConvexStudioModule[];
  httpRoutes: ConvexStudioHttpRoute[];
  siteUrl: string | null;
  truncated: boolean;
}

export interface ConvexStudioFunctionDetail {
  args: unknown | null;
  source: string | null;
  sourceTruncated: boolean;
}

export interface ConvexStudioFunctionRun {
  success: boolean;
  value: unknown;
  errorMessage: string | null;
  errorData: unknown;
  logLines: string[];
  logLinesTruncated: boolean;
  durationMs: number;
}

export interface ConvexStudioHttpResponse {
  url: string;
  status: number;
  headers: [string, string][];
  body: string;
  size: number;
  truncated: boolean;
  durationMs: number;
}

export interface ConvexStudioStatsBucket {
  time: number;
  invocations: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface ConvexStudioFunctionStats {
  windowMinutes: number;
  invocations: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  buckets: ConvexStudioStatsBucket[];
}

export interface ConvexStudioTarget {
  id: string;
  projectId: number;
  deploymentName: string;
}

export const convexStudioFunctionsList = (target: ConvexStudioTarget) =>
  invoke<ConvexStudioFunctionCatalog>("convex_studio_functions_list", { ...target });

export const convexStudioFunctionsDetail = (
  target: ConvexStudioTarget,
  identifier: string,
  componentId: string | null,
) =>
  invoke<ConvexStudioFunctionDetail>("convex_studio_functions_detail", {
    ...target,
    identifier,
    componentId,
  });

export const convexStudioFunctionsRun = (
  target: ConvexStudioTarget,
  identifier: string,
  args: Record<string, unknown>,
  componentPath: string | null,
) =>
  invoke<ConvexStudioFunctionRun>("convex_studio_functions_run", {
    ...target,
    identifier,
    args,
    componentPath,
  });

export const convexStudioFunctionsHttpRequest = (
  target: ConvexStudioTarget,
  request: { method: string; path: string; headers: [string, string][]; body: string | null },
) =>
  invoke<ConvexStudioHttpResponse>("convex_studio_functions_http_request", {
    ...target,
    ...request,
  });

export const convexStudioFunctionsStats = (
  target: ConvexStudioTarget,
  identifier: string,
  windowMinutes: number,
) =>
  invoke<ConvexStudioFunctionStats>("convex_studio_functions_stats", {
    ...target,
    identifier,
    windowMinutes,
  });
