import { create } from "zustand";
import type { DatabaseKind } from "@/lib/db";

export interface DbThemeTokens {
  hue: number;
  chroma: number;
  glow: number;
  shader: [string, string, string];
}

const KIND_THEMES: Record<DatabaseKind, DbThemeTokens> = {
  postgres: { hue: 248, chroma: 0.13, glow: 0.2, shader: ["#1b3a7a", "#6ea8ff", "#d7e6ff"] },
  mysql: { hue: 42, chroma: 0.14, glow: 0.18, shader: ["#7a4a12", "#f0b429", "#ffe7b3"] },
  sqlite: { hue: 80, chroma: 0.05, glow: 0.08, shader: ["#3a3a32", "#c8c4b0", "#f2efe4"] },
  mssql: { hue: 214, chroma: 0.12, glow: 0.16, shader: ["#12305c", "#5b9dff", "#d4e6ff"] },
  clickhouse: { hue: 88, chroma: 0.14, glow: 0.18, shader: ["#3d4a10", "#c6e04a", "#f3f7c8"] },
  mongodb: { hue: 148, chroma: 0.14, glow: 0.2, shader: ["#0f3d2a", "#3dd68c", "#d4ffe8"] },
  redis: { hue: 18, chroma: 0.16, glow: 0.2, shader: ["#5c1510", "#ff5a4a", "#ffd4cc"] },
  oracle: { hue: 32, chroma: 0.16, glow: 0.18, shader: ["#5c2a08", "#ff7a1a", "#ffd8b5"] },
  cassandra: { hue: 28, chroma: 0.12, glow: 0.14, shader: ["#4a2c14", "#e08a3c", "#ffe2c4"] },
  duckdb: { hue: 75, chroma: 0.12, glow: 0.14, shader: ["#3a3a14", "#e6d34a", "#fff6c2"] },
  odbc: { hue: 230, chroma: 0.08, glow: 0.1, shader: ["#20243a", "#8ea0d4", "#e4e8f6"] },
};

const PROVIDER_THEMES: Record<string, DbThemeTokens> = {
  mariadb: { hue: 348, chroma: 0.15, glow: 0.2, shader: ["#4a1024", "#e23d6e", "#ffd4e0"] },
  supabase: { hue: 162, chroma: 0.14, glow: 0.2, shader: ["#0d3b2e", "#3ecf8e", "#d4ffe8"] },
  neon: { hue: 155, chroma: 0.16, glow: 0.22, shader: ["#063322", "#12e59a", "#c8ffe8"] },
  planetscale: { hue: 270, chroma: 0.08, glow: 0.12, shader: ["#1c1228", "#b48cff", "#efe6ff"] },
};

export function resolveDbTheme(kind?: DatabaseKind | null, providerId?: string | null): DbThemeTokens {
  if (providerId && PROVIDER_THEMES[providerId]) return PROVIDER_THEMES[providerId];
  return KIND_THEMES[kind ?? "postgres"];
}

export function themeCssVars(tokens: DbThemeTokens): Record<string, string> {
  return {
    "--db-hue": String(tokens.hue),
    "--db-chroma": String(Math.min(tokens.chroma, 0.045)),
    "--db-glow": String(Math.min(tokens.glow, 0.05)),
    "--db-shader-1": tokens.shader[0],
    "--db-shader-2": tokens.shader[1],
    "--db-shader-3": tokens.shader[2],
  };
}

interface DbThemeState {
  previewKind: DatabaseKind | null;
  previewProvider: string | null;
  setPreview: (kind: DatabaseKind | null, providerId?: string | null) => void;
}

export const useDbThemeStore = create<DbThemeState>((set) => ({
  previewKind: null,
  previewProvider: null,
  setPreview: (kind, providerId = null) => set({ previewKind: kind, previewProvider: providerId }),
}));
