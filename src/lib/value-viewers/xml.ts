const XML_TYPE = /^(?:sys\.)?xml(?:type)?$/;
const TOKEN =
  /(<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/?[^>]+>)/gi;

export function isXmlDataType(dataType?: string | null): boolean {
  if (!dataType) return false;
  return XML_TYPE.test(dataType.toLowerCase().trim());
}

export function looksLikeXml(value: string): boolean {
  const head = value.slice(0, 256).trimStart();
  if (!head.startsWith("<")) return false;
  const tail = value.slice(-64).trimEnd();
  return tail.endsWith(">") && /^<(?:\?xml|!--|!DOCTYPE|[A-Za-z_][\w.:-]*[\s/>])/i.test(head);
}

export function formatXml(text: string, indent = "  "): string {
  const parts = text.split(TOKEN);
  const lines: string[] = [];
  let depth = 0;
  let pendingText: string | null = null;
  const push = (line: string) => lines.push(indent.repeat(Math.max(0, depth)) + line);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 0) {
      const trimmed = part.trim();
      if (trimmed) pendingText = trimmed;
      continue;
    }
    if (part.startsWith("</")) {
      const last = lines[lines.length - 1] ?? "";
      if (pendingText !== null && /^\s*<[^/!?][^>]*>$/.test(last) && !last.endsWith("/>")) {
        lines[lines.length - 1] += pendingText + part;
        pendingText = null;
        depth--;
        continue;
      }
      if (pendingText !== null) push(pendingText);
      pendingText = null;
      depth--;
      push(part);
      continue;
    }
    if (pendingText !== null) push(pendingText);
    pendingText = null;
    push(part);
    const isOpen = !part.startsWith("<?") && !part.startsWith("<!") && !part.endsWith("/>");
    if (isOpen) depth++;
  }
  if (pendingText !== null) push(pendingText);
  return lines.join("\n");
}

export type XmlParseResult =
  | { document: Document; error: null }
  | { document: null; error: string };

export function parseXml(text: string): XmlParseResult {
  if (typeof DOMParser === "undefined")
    return { document: null, error: "XML-Parser nicht verfügbar." };
  const document = new DOMParser().parseFromString(text, "application/xml");
  const error = document.getElementsByTagName("parsererror")[0];
  if (error) {
    const message = (error.textContent ?? "").replace(/\s+/g, " ").trim();
    return { document: null, error: message || "Ungültiges XML." };
  }
  return { document, error: null };
}
