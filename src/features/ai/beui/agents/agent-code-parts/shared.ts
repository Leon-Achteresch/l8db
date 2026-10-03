import { useEffect, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import bash from "shiki/dist/langs/bash.mjs";
import diff from "shiki/dist/langs/diff.mjs";
import json from "shiki/dist/langs/json.mjs";
import sql from "shiki/dist/langs/sql.mjs";
import tsx from "shiki/dist/langs/tsx.mjs";
import typescript from "shiki/dist/langs/typescript.mjs";
import dark from "shiki/dist/themes/github-dark-high-contrast.mjs";
import light from "shiki/dist/themes/github-light-high-contrast.mjs";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export type AgentCodeLanguage = "bash" | "diff" | "json" | "text" | "tsx" | "typescript" | "sql";
export interface AgentCodeToken {
  content: string;
  offset: number;
  light?: string;
  dark?: string;
}
export type AgentCodeTokenLines = AgentCodeToken[][];
export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}
export interface AgentCodeLineProps {
  code: string;
  tokens?: AgentCodeToken[];
  className?: string;
}
export const LIGHT_THEME = "github-light-high-contrast";
export const DARK_THEME = "github-dark-high-contrast";
export let agentCodeHighlighter: Promise<HighlighterCore> | null = null;
export const tokenCache = new Map<string, AgentCodeTokenLines>();
export function getAgentCodeHighlighter() {
  if (!agentCodeHighlighter) {
    agentCodeHighlighter = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [light, dark],
      langs: [bash, diff, json, tsx, typescript, sql],
    });
  }
  return agentCodeHighlighter;
}
export function tokenCacheKey(code: string, language: AgentCodeLanguage) {
  return `${language}\u0000${code}`;
}
export function useAgentCodeTokens(code: string, language: AgentCodeLanguage) {
  const key = tokenCacheKey(code, language);
  const cached = tokenCache.get(key);
  const [result, setResult] = useState<{
    key: string;
    code: string;
    language: AgentCodeLanguage;
    lines: AgentCodeTokenLines;
  } | null>(cached ? { key, code, language, lines: cached } : null);
  useEffect(() => {
    if (code.length > 64000 || code.split("\n").length > 2000) return;
    const current = tokenCache.get(key);
    if (current) {
      setResult({ key, code, language, lines: current });
      return;
    }
    let cancelled = false;
    getAgentCodeHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        const lines = highlighter
          .codeToTokensWithThemes(code, {
            lang: language,
            themes: {
              light: LIGHT_THEME,
              dark: DARK_THEME,
            },
          })
          .map((line) =>
            line.map((token) => ({
              content: token.content,
              offset: token.offset,
              light: token.variants.light?.color,
              dark: token.variants.dark?.color,
            })),
          );
        if (tokenCache.size > 80) tokenCache.delete(tokenCache.keys().next().value ?? "");
        tokenCache.set(key, lines);
        setResult({ key, code, language, lines });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [code, key, language]);
  if (result?.key === key) return result.lines;
  if (result?.language === language && code.startsWith(result.code)) {
    return result.lines;
  }
  return null;
}
