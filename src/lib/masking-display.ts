import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { create } from "zustand";
import { useActiveConnection } from "@/lib/connections";
import { DEFAULT_MASK_TEXT, type MaskRule, resolveMasks } from "@/lib/masking";
import { loadMcpConfig, type McpConfig } from "@/lib/mcp";

interface MaskingDisplayState {
  enabled: Record<string, boolean>;
  toggle: (connectionId: string) => void;
}

export const useMaskingDisplay = create<MaskingDisplayState>((set) => ({
  enabled: {},
  toggle: (connectionId) =>
    set((state) => ({
      enabled: { ...state.enabled, [connectionId]: !state.enabled[connectionId] },
    })),
}));

export function connectionMaskRules(
  connection: { id: string; maskRules?: MaskRule[] } | null | undefined,
  config: McpConfig | null | undefined,
): { rules: MaskRule[]; replacement: string } {
  if (!connection) return { rules: [], replacement: DEFAULT_MASK_TEXT };
  const mcp = config?.connections.find((entry) => entry.id === connection.id);
  return {
    rules: [
      ...(connection.maskRules ?? []),
      ...(mcp?.redactColumns ?? []).map((pattern) => ({
        name: pattern,
        pattern,
        enabled: true,
        mask: "text" as const,
      })),
      ...(config?.redaction.columns ?? []),
    ],
    replacement: config?.redaction.replacement || DEFAULT_MASK_TEXT,
  };
}

export function useActiveMasks(columns: string[]) {
  const connection = useActiveConnection();
  const enabled = useMaskingDisplay((state) =>
    connection ? Boolean(state.enabled[connection.id]) : false,
  );
  const { data: config } = useQuery({
    queryKey: ["mcp-config"],
    queryFn: loadMcpConfig,
    staleTime: 60_000,
    retry: false,
  });
  const key = columns.join("\u0001");
  const masks = useMemo(() => {
    const { rules, replacement } = connectionMaskRules(connection, config);
    return resolveMasks(key ? key.split("\u0001") : [], rules, replacement);
  }, [connection, config, key]);
  return { enabled, masks, active: enabled ? masks : [] };
}
