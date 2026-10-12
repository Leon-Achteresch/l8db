export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!source.trim()) return attributes;
  ATTRIBUTE.lastIndex = 0;
  for (let match = ATTRIBUTE.exec(source); match; match = ATTRIBUTE.exec(source)) {
    attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function tagEnd(source: string, from: number): number {
  let quote = "";
  for (let index = from; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function declarationEnd(source: string, from: number): number {
  let quote = "";
  let depth = 0;
  for (let index = from; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) return -1;
      index = end + 2;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth = Math.max(0, depth - 1);
    } else if (char === ">" && depth === 0) {
      return index;
    }
  }
  return -1;
}

function invalid(detail: string): Error {
  return new Error(`Ungültiges XML: ${detail}`);
}

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let position = 0;
  const length = source.length;
  while (position < length) {
    const open = source.indexOf("<", position);
    const textEnd = open < 0 ? length : open;
    if (textEnd > position) {
      const text = source.slice(position, textEnd);
      if (stack.length > 1 && text.trim()) stack[stack.length - 1].text += decodeXmlEntities(text);
    }
    if (open < 0) break;
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end < 0) throw invalid("Kommentar ist nicht geschlossen.");
      position = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      if (end < 0) throw invalid("CDATA-Block ist nicht geschlossen.");
      if (stack.length > 1) stack[stack.length - 1].text += source.slice(open + 9, end);
      position = end + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end < 0) throw invalid("Verarbeitungsanweisung ist nicht geschlossen.");
      position = end + 2;
      continue;
    }
    if (source.startsWith("<!", open)) {
      const end = declarationEnd(source, open + 2);
      if (end < 0) throw invalid("Deklaration ist nicht geschlossen.");
      position = end + 1;
      continue;
    }
    const close = tagEnd(source, open + 1);
    if (close < 0) throw invalid("Element ist nicht geschlossen.");
    const body = source.slice(open + 1, close);
    position = close + 1;
    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      const current = stack.pop();
      if (!current || current === root || current.name !== name) {
        throw invalid(`Unerwartetes </${name}>.`);
      }
      continue;
    }
    const selfClosing = body.endsWith("/");
    const content = selfClosing ? body.slice(0, -1) : body;
    const nameEnd = content.search(/[\s]/);
    const name = nameEnd < 0 ? content : content.slice(0, nameEnd);
    if (!name || /[<"'=]/.test(name)) throw invalid("Elementname fehlt.");
    const element: XmlElement = {
      name,
      attributes: parseAttributes(nameEnd < 0 ? "" : content.slice(nameEnd)),
      children: [],
      text: "",
    };
    stack[stack.length - 1].children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length > 1) throw invalid(`<${stack[stack.length - 1].name}> ist nicht geschlossen.`);
  if (root.children.length === 0) throw invalid("Kein Wurzelelement gefunden.");
  return root;
}

function sameName(element: XmlElement, name: string): boolean {
  return element.name.toLowerCase() === name.toLowerCase();
}

export function childElement(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => sameName(child, name));
}

export function childText(element: XmlElement, name: string): string {
  return childElement(element, name)?.text.trim() ?? "";
}

export function findElements(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const pending = [element];
  while (pending.length) {
    const current = pending.pop() as XmlElement;
    if (current !== element && sameName(current, name)) found.push(current);
    for (let index = current.children.length - 1; index >= 0; index--)
      pending.push(current.children[index]);
  }
  return found;
}

export function attribute(element: XmlElement, ...names: string[]): string {
  const keys = Object.keys(element.attributes);
  for (const name of names) {
    const direct = element.attributes[name];
    if (direct?.trim()) return direct.trim();
    const lower = name.toLowerCase();
    const key = keys.find((entry) => entry.toLowerCase() === lower);
    if (key && element.attributes[key].trim()) return element.attributes[key].trim();
  }
  return "";
}
