import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Snippet {
  id: string;
  name: string;
  shortcut: string;
  description: string;
  category: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetInput {
  name: string;
  shortcut: string;
  description: string;
  category: string;
  body: string;
}

interface SnippetsState {
  snippets: Snippet[];
  addSnippet: (input: SnippetInput) => Snippet;
  updateSnippet: (id: string, input: SnippetInput) => void;
  deleteSnippet: (id: string) => void;
}

export const SNIPPET_PLACEHOLDER_HINT =
  "${name} für Platzhalter, ${name:Vorgabe} mit Vorgabewert, ${cursor} für die Endposition";

export function normalizeShortcut(shortcut: string): string {
  return shortcut.trim().toLowerCase();
}

export function findShortcutConflict(
  snippets: Snippet[],
  shortcut: string,
  ignoreId?: string,
): Snippet | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return null;
  return (
    snippets.find(
      (snippet) => snippet.id !== ignoreId && normalizeShortcut(snippet.shortcut) === normalized,
    ) ?? null
  );
}

export function searchSnippets(snippets: Snippet[], term: string): Snippet[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return snippets;
  return snippets.filter((snippet) =>
    [snippet.name, snippet.category, snippet.description, snippet.shortcut].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

export function snippetCategories(snippets: Snippet[]): string[] {
  const names = new Set<string>();
  for (const snippet of snippets) {
    const category = snippet.category.trim();
    if (category) names.add(category);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "de"));
}

function escapeSnippetText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/\}/g, "\\}");
}

export function snippetPlaceholders(body: string): string[] {
  const names: string[] = [];
  const pattern = /\$\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.toLowerCase() === "cursor") continue;
    const separator = raw.indexOf(":");
    const name = (separator >= 0 ? raw.slice(0, separator) : raw).trim();
    if (name && !names.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  }
  return names;
}

export function toMonacoSnippet(body: string): string {
  const indices = new Map<string, number>();
  let nextIndex = 1;
  let out = "";
  let last = 0;
  const pattern = /\$\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    out += escapeSnippetText(body.slice(last, match.index));
    last = match.index + match[0].length;

    const raw = match[1].trim();
    if (raw.toLowerCase() === "cursor") {
      out += "$0";
      continue;
    }
    if (!raw) {
      out += `$${nextIndex}`;
      nextIndex += 1;
      continue;
    }

    const separator = raw.indexOf(":");
    const name = (separator >= 0 ? raw.slice(0, separator) : raw).trim();
    const fallback = separator >= 0 ? raw.slice(separator + 1) : name;
    const key = name.toLowerCase();
    let index = indices.get(key);
    if (index === undefined) {
      index = nextIndex;
      nextIndex += 1;
      indices.set(key, index);
      out += `\${${index}:${escapeSnippetText(fallback)}}`;
    } else {
      out += `$${index}`;
    }
  }

  out += escapeSnippetText(body.slice(last));
  return out;
}

function sanitize(input: SnippetInput) {
  return {
    name: input.name.trim(),
    shortcut: input.shortcut.trim(),
    description: input.description.trim(),
    category: input.category.trim(),
    body: input.body,
  };
}

export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set) => ({
      snippets: [],

      addSnippet: (input) => {
        const now = Date.now();
        const snippet: Snippet = {
          id: crypto.randomUUID(),
          ...sanitize(input),
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ snippets: [snippet, ...state.snippets] }));
        return snippet;
      },

      updateSnippet: (id, input) =>
        set((state) => ({
          snippets: state.snippets.map((snippet) =>
            snippet.id === id
              ? { ...snippet, ...sanitize(input), updatedAt: Date.now() }
              : snippet,
          ),
        })),

      deleteSnippet: (id) =>
        set((state) => ({ snippets: state.snippets.filter((snippet) => snippet.id !== id) })),
    }),
    {
      name: "l8db.snippets",
      partialize: (state) => ({ snippets: state.snippets }),
    },
  ),
);
