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
  | { t: "hr" }
  | { t: "pre"; v: string };

const INLINE_RE = /(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`|\[[^\]]+?\]\([^)]+?\))/g;

export function parseInline(source: string): MdInline[] {
  const parts = source.split(INLINE_RE).filter((part) => part.length > 0);
  return parts.map((part): MdInline => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return { t: "strong", children: parseInline(part.slice(2, -2)) };
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return { t: "em", children: parseInline(part.slice(1, -1)) };
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return { t: "code", v: part.slice(1, -1) };
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
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ t: "p", children: parseInline(para.join(" ")) });
  }

  return blocks;
}
