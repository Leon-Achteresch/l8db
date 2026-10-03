export type MdInline =
  | { t: "text"; v: string }
  | { t: "strong"; children: MdInline[] }
  | { t: "em"; children: MdInline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; children: MdInline[] };

export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3 | 4; children: MdInline[] }
  | { t: "p"; children: MdInline[] }
  | { t: "ul"; items: MdInline[][] }
  | { t: "ol"; start: number; items: MdInline[][] }
  | { t: "quote"; children: MdInline[] }
  | { t: "hr" }
  | { t: "pre"; v: string };

export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^(https?:|mailto:|#)/i.test(trimmed) ? trimmed : null;
}

const INLINE_RE =
  /\\[\\`*[\]]|\*\*[^*]+?\*\*|\*[^*]+?\*|(?<!`)(?<fence>`+)(?!`)[\s\S]+?(?<!`)\k<fence>(?!`)|\[[^\]]+?\]\([^)]+?\)/g;

export function parseInline(source: string): MdInline[] {
  const parts: string[] = [];
  let end = 0;
  for (const match of source.matchAll(INLINE_RE)) {
    if (match.index > end) parts.push(source.slice(end, match.index));
    parts.push(match[0]);
    end = match.index + match[0].length;
  }
  if (end < source.length) parts.push(source.slice(end));
  return parts.map((part): MdInline => {
    if (/^\\[\\`*[\]]$/.test(part)) return { t: "text", v: part.slice(1) };
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return { t: "strong", children: parseInline(part.slice(2, -2)) };
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return { t: "em", children: parseInline(part.slice(1, -1)) };
    }
    const code = part.match(/^(`+)([\s\S]+?)\1$/);
    if (code) {
      return { t: "code", v: code[2] };
    }
    const link = part.match(/^\[([^\]]+)]\(([^)]+)\)$/);
    if (link) {
      return { t: "link", href: link[2], children: parseInline(link[1]) };
    }
    return { t: "text", v: part };
  });
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ t: "hr" });
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        t: "h",
        level: heading[1].length as 1 | 2 | 3 | 4,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*[-*]\s+/, "")));
        i += 1;
      }
      blocks.push({ t: "ul", items });
      continue;
    }
    const ordered = line.match(/^\s*(\d+)[.)]\s+/);
    if (ordered) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*\d+[.)]\s+/, "")));
        i += 1;
      }
      blocks.push({ t: "ol", start: Number(ordered[1]), items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ t: "quote", children: parseInline(quote.join(" ")) });
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ t: "p", children: parseInline(para.join(" ")) });
  }

  return blocks;
}

export function extractHighlights(source: string, max = 3): string[] {
  const items: string[] = [];
  for (const line of source.split("\n")) {
    const match = line.trim().match(/^[-*•+]\s+(.+)$/) ?? line.trim().match(/^\d+\.\s+(.+)$/);
    if (!match?.[1]) continue;
    const clean = match[1]
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
    if (clean && !items.includes(clean)) items.push(clean);
    if (items.length >= max) break;
  }
  return items;
}
